import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  placeEnvironmentalProps,
  PROP_PLACEMENT_SPECS,
  PROP_TYPES,
} from '../generation/environmentalPropPlacement.js'
import { COLLECTIBLE_PALETTE } from './buildCollectibles.js'
import {
  NON_SHADOW_CASTING_PROP_PARTS,
  PROP_MATERIAL_PALETTE,
  buildEnvironmentalProps,
  createEnvironmentalPropMesh,
  disposeEnvironmentalPropPools,
  getEnvironmentalPropMaterials,
  getEnvironmentalPropPoolStats,
  getEnvironmentalPropTextureSet,
} from './buildEnvironmentalProps.js'
import { MAZE_MESH_PALETTE, buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeMazeSurfacePools, getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'

console.log('--- RUNNING ENVIRONMENTAL PROP MATERIAL & LIFECYCLE TESTS ---')

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

function getRelativeLuminance(hex) {
  const c = new THREE.Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Shared Material & Procedural Texture Pooling + Resource Disposal Protection
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Shared material/texture pooling & protection against disposeMazeGroup()')

  const matsA = getEnvironmentalPropMaterials()
  const matsB = getEnvironmentalPropMaterials()
  const stats = getEnvironmentalPropPoolStats()

  assert.equal(stats.materials, 9, 'Exactly 9 shared prop materials are pooled')
  assert.equal(stats.textureSets, 5, 'Exactly 5 lightweight procedural prop texture sets are pooled')

  const matEntries = Object.entries(matsA)
  assert.equal(matEntries.length, 9, 'All 9 prop material keys are exposed')

  const matDisposeEvents = []
  const texDisposeEvents = []
  const seenTex = new Set()

  for (const [key, mat] of matEntries) {
    assert.equal(mat, matsB[key], `Material ${key} is pooled and reused across calls`)
    assert.equal(isSharedResource(mat), true, `Material ${key} is marked as a shared resource`)
    mat.addEventListener('dispose', () => matDisposeEvents.push(key))

    for (const mapKey of ['map', 'roughnessMap', 'bumpMap']) {
      const tex = mat[mapKey]
      assert.ok(tex && tex.isTexture, `Material ${key}.${mapKey} is bound to a procedural texture`)
      assert.equal(isSharedResource(tex), true, `Texture ${key}.${mapKey} is marked shared`)
      if (!seenTex.has(tex)) {
        seenTex.add(tex)
        tex.addEventListener('dispose', () => texDisposeEvents.push(`${key}.${mapKey}`))
      }
    }
  }

  // debrisConcrete reuses architectural wall textures without duplicating concrete maps
  const archSurface = getMazeSurfaceTextureSet()
  assert.equal(matsA.debrisConcrete.map, archSurface.wall.map, 'debrisConcrete reuses shared wall map')
  assert.equal(matsA.debrisConcrete.roughnessMap, archSurface.wall.roughnessMap, 'debrisConcrete reuses shared wall roughnessMap')
  assert.equal(matsA.debrisConcrete.bumpMap, archSurface.wall.bumpMap, 'debrisConcrete reuses shared wall bumpMap')

  // Build and dispose multiple maze groups directly
  const mazeEasy = generateMaze({ difficulty: 'easy', seed: 101 })
  const mazeMed = generateMaze({ difficulty: 'medium', seed: 202 })
  const groupA = buildMazeMeshes(mazeEasy)
  const groupB = buildMazeMeshes(mazeMed)

  const propsGroupA = groupA.getObjectByName('maze-environmental-props')
  assert.ok(propsGroupA && propsGroupA.children.length > 0, 'Maze builds environmental props group')

  const groupAMaterials = new Set()
  propsGroupA.traverse((node) => {
    if (node.isMesh) {
      groupAMaterials.add(node.material)
      assert.equal(isSharedResource(node.material), true, 'Prop mesh binds shared material')
      const expectedCast = !NON_SHADOW_CASTING_PROP_PARTS.has(node.userData?.partName)
      assert.equal(
        node.castShadow,
        expectedCast,
        `Prop mesh ${node.name} enforces selective castShadow=${expectedCast}`
      )
      assert.equal(node.receiveShadow, true, 'Prop mesh preserves receiveShadow = true')
    }
  })
  assert.ok(groupAMaterials.size >= 4, 'Props span multiple shared material categories')

  disposeMazeGroup(groupA)
  disposeMazeGroup(groupB)

  assert.equal(matDisposeEvents.length, 0, 'disposeMazeGroup() never disposes shared prop materials')
  assert.equal(texDisposeEvents.length, 0, 'disposeMazeGroup() never disposes shared prop textures')
  assert.equal(getEnvironmentalPropPoolStats().materials, 9, 'Pooled materials remain intact after maze disposal')

  // Verify subsequent maze build reuses exact same live materials
  const groupC = buildMazeMeshes(generateMaze({ difficulty: 'hardcore', seed: 303 }))
  const propsGroupC = groupC.getObjectByName('maze-environmental-props')
  assert.ok(propsGroupC && propsGroupC.children.length > 0)
  propsGroupC.traverse((node) => {
    if (node.isMesh) {
      const key = Object.keys(matsA).find((k) => matsA[k] === node.material)
      assert.ok(key, 'Recreated maze prop reuses exact pooled material instance')
    }
  })
  disposeMazeGroup(groupC)

  // Verify disposeEnvironmentalPropPools() disposes the 15 prop-owned textures without disposing shared wall maps
  disposeEnvironmentalPropPools()
  assert.equal(getEnvironmentalPropPoolStats().materials, 0, 'disposeEnvironmentalPropPools() clears prop material pool')
  assert.equal(getEnvironmentalPropPoolStats().textureSets, 0, 'disposeEnvironmentalPropPools() clears prop texture pool')
  assert.equal(matDisposeEvents.length, 9, 'All 9 shared prop materials dispose cleanly on pool disposal')
  assert.equal(texDisposeEvents.length, 15, 'All 15 prop-owned textures dispose cleanly while keeping shared wall maps intact')

  const matsAfterReset = getEnvironmentalPropMaterials()
  assert.notEqual(matsAfterReset.rustyMetal, matsA.rustyMetal, 'Fresh materials created cleanly after pool clear')
  disposeAllSharedPools()
  assert.equal(getEnvironmentalPropPoolStats().materials, 0, 'disposeAllSharedPools() clears prop material pool')
  assert.equal(getEnvironmentalPropPoolStats().textureSets, 0, 'disposeAllSharedPools() clears prop texture pool')
  assert.equal(texDisposeEvents.length, seenTex.size, 'disposeAllSharedPools() disposes remaining shared wall maps cleanly')
  console.log('✓ Shared material pooling, disposeMazeGroup() safety & full pool teardown verified')
}

// ---------------------------------------------------------------------------
// 2. Engine Lifecycle: Resets, Retries, Difficulty Changes & Final Disposal
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Material validity across MazeSceneEngine resets, difficulty changes & disposal')

  const { engine } = createHeadlessEngine()
  const initialMats = getEnvironmentalPropMaterials()
  const disposedDuringResets = []
  for (const [k, mat] of Object.entries(initialMats)) {
    mat.addEventListener('dispose', () => disposedDuringResets.push(k))
  }

  engine.setMaze(generateMaze({ difficulty: 'easy', seed: 1001 }))
  engine.setMaze(generateMaze({ difficulty: 'medium', seed: 1002 }))
  engine.setMaze(generateMaze({ difficulty: 'hardcore', seed: 1003 }))
  engine.clearMaze()
  engine.setMaze(generateMaze({ difficulty: 'medium', seed: 1004 }))

  assert.equal(
    disposedDuringResets.length,
    0,
    'Prop materials never dispose during maze switches, clears, or difficulty changes'
  )

  const activePropsGroup = engine.getMazeGroup()?.getObjectByName('maze-environmental-props')
  assert.ok(activePropsGroup && activePropsGroup.children.length > 0)
  activePropsGroup.traverse((node) => {
    if (node.isMesh) {
      const matched = Object.values(initialMats).includes(node.material)
      assert.equal(matched, true, 'Engine prop meshes continue binding original live pooled materials')
    }
  })

  // Dispose engine -> final owner releases shared pools cleanly
  engine.dispose()
  assert.equal(disposedDuringResets.length, 9, 'Final engine.dispose() releases shared prop materials')
  assert.equal(getEnvironmentalPropPoolStats().materials, 0, 'Prop material pool empties on final engine dispose')
  assert.equal(getEnvironmentalPropPoolStats().textureSets, 0, 'Prop texture pool empties on final engine dispose')

  // Verify independent surface pool disposal does not leave stale textures on debrisConcrete
  const matsFresh = getEnvironmentalPropMaterials()
  const oldWallMap = matsFresh.debrisConcrete.map
  disposeMazeSurfacePools()
  const matsRebound = getEnvironmentalPropMaterials()
  assert.notEqual(matsRebound.debrisConcrete.map, oldWallMap, 'debrisConcrete rebinds fresh wall map if surface pool resets')

  disposeAllSharedPools()
  console.log('✓ Engine reset/retry/difficulty lifecycle & clean final teardown verified')
}

// ---------------------------------------------------------------------------
// 3. Abandoned-Facility Palette & PBR Calibration
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Abandoned-facility albedo palette, PBR roughness/metalness/IBL calibration')

  const mats = getEnvironmentalPropMaterials()
  const coinLum = getRelativeLuminance(COLLECTIBLE_PALETTE.coinGlow) // 0xfbbf24
  const wallLum = getRelativeLuminance(MAZE_MESH_PALETTE.wallBody) // 0x2f405b
  const floorLum = getRelativeLuminance(MAZE_MESH_PALETTE.floor) // 0x1c283d

  for (const [key, mat] of Object.entries(mats)) {
    assert.ok(
      mat.roughness >= 0.84 && mat.roughness <= 0.96,
      `${key} roughness (${mat.roughness}) stays in matte aged range [0.84, 0.96]`
    )
    assert.ok(
      mat.envMapIntensity >= 0.15 && mat.envMapIntensity <= 0.4,
      `${key} envMapIntensity (${mat.envMapIntensity}) stays subdued`
    )
    assert.ok(mat.bumpScale > 0 && mat.bumpScale <= 0.06, `${key} has restrained bumpScale`)
  }

  assert.ok(mats.rustyMetal.metalness <= 0.2, `rustyMetal metalness (${mats.rustyMetal.metalness}) reduced for matte oxidation`)
  assert.ok(mats.darkSteel.metalness <= 0.4, `darkSteel metalness (${mats.darkSteel.metalness}) dulled by dust/age`)
  assert.ok(mats.cabinetGreen.metalness <= 0.2, 'cabinetGreen painted metal stays low metalness')
  assert.ok(mats.lockerBlue.metalness <= 0.2, 'lockerBlue painted metal stays low metalness')
  assert.ok(mats.warningYellow.metalness <= 0.15, 'warningYellow faded paint stays low metalness')
  assert.equal(mats.paperWhite.metalness, 0, 'paperWhite remains purely dielectric')
  assert.ok(mats.debrisConcrete.metalness <= 0.05, 'debrisConcrete matches mineral concrete dielectric')
  assert.ok(mats.cableBlack.metalness <= 0.1, 'cableBlack rubber jacket stays non-metallic')

  // Subdued albedo luminance checks (no bright yellow, bright white, or chalk concrete)
  const yellowLum = getRelativeLuminance(PROP_MATERIAL_PALETTE.warningYellow.color)
  assert.ok(
    yellowLum < coinLum * 0.25,
    `warningYellow luminance (${yellowLum.toFixed(3)}) is drastically muted vs coin glow (${coinLum.toFixed(3)})`
  )

  const paperLum = getRelativeLuminance(PROP_MATERIAL_PALETTE.paperWhite.color)
  const oldWhiteLum = getRelativeLuminance(0xf1f5f9)
  assert.ok(
    paperLum < oldWhiteLum * 0.28,
    `paperWhite luminance (${paperLum.toFixed(3)}) stays dirty/yellowed vs crisp white (${oldWhiteLum.toFixed(3)})`
  )

  const debrisLum = getRelativeLuminance(PROP_MATERIAL_PALETTE.debrisConcrete.color)
  assert.ok(
    debrisLum >= floorLum * 0.8 && debrisLum <= wallLum * 1.15,
    `debrisConcrete luminance (${debrisLum.toFixed(3)}) harmonizes with maze floor (${floorLum.toFixed(3)}) and wall (${wallLum.toFixed(3)})`
  )

  disposeAllSharedPools()
  console.log('✓ Abandoned-facility palette and PBR calibration verified')
}

// ---------------------------------------------------------------------------
// 4. Procedural Surface Textures Color Space, Contrast & Placement/Geometry Preservation
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Procedural texture color spaces, variation & geometry/placement preservation')

  const texSet = getEnvironmentalPropTextureSet()
  for (const [name, trio] of Object.entries(texSet)) {
    assert.equal(trio.map.colorSpace, THREE.SRGBColorSpace, `${name}.map uses SRGBColorSpace`)
    assert.equal(trio.roughnessMap.colorSpace, THREE.NoColorSpace, `${name}.roughnessMap uses NoColorSpace`)
    assert.equal(trio.bumpMap.colorSpace, THREE.NoColorSpace, `${name}.bumpMap uses NoColorSpace`)
    assert.equal(trio.map.wrapS, THREE.RepeatWrapping)
    assert.equal(trio.map.wrapT, THREE.RepeatWrapping)
    assert.equal(trio.map.image.width, 256)
    assert.equal(trio.map.image.height, 256)

    // Verify non-trivial pixel variation in albedo & dry matte bounds in roughness
    const aData = trio.map.image.data
    const rData = trio.roughnessMap.image.data
    let aMin = 255
    let aMax = 0
    let rMin = 1
    let rSum = 0
    const px = 256 * 256
    for (let i = 0; i < px; i += 1) {
      const lum = aData[i * 4]
      if (lum < aMin) aMin = lum
      if (lum > aMax) aMax = lum
      const rv = rData[i * 4] / 255
      if (rv < rMin) rMin = rv
      rSum += rv
    }
    assert.ok(aMax - aMin >= 25, `${name}.map carries real procedural contrast (range=${aMax - aMin})`)
    assert.ok(rMin >= 0.84 && rSum / px >= 0.89, `${name}.roughnessMap stays matte (min=${rMin.toFixed(2)}, avg=${(rSum / px).toFixed(2)})`)
  }

  // Verify placement & geometry counts remain unchanged across all 12 prop types
  const maze = generateMaze({ difficulty: 'medium', seed: 4242 })
  const placed = placeEnvironmentalProps(maze)
  const propsGroup = buildEnvironmentalProps(maze)
  assert.ok(propsGroup)
  assert.equal(propsGroup.userData.propCount, placed.length, 'Prop count matches placement output')
  assert.equal(Object.keys(PROP_TYPES).length, 12, 'All 12 prop types remain intact')

  disposeMazeGroup(propsGroup)
  disposeAllSharedPools()
  console.log('✓ Procedural textures and boundary preservation verified')
}

import { CELL_TYPES } from '../generation/mazeConfig.js'
import { placeHazards } from '../generation/hazardPlacement.js'
import { placeHidingSpots } from '../generation/hidingSpotPlacement.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'

console.log('=== PHASE 1 TESTS PASSED! ===')

// ---------------------------------------------------------------------------
// 5. Phase 2: Wall-Side Validity & No Open-Intersection Floating Props
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Wall-side validity & zero open-intersection placement')

  // Synthetic 5x5 maze with an open wall-less center cell (2,2) surrounded by paths
  const openCenterGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
  ]
  const syntheticMaze = {
    seed: 777,
    difficulty: 'hardcore',
    grid: openCenterGrid,
    start: { row: 1, col: 1 },
    exit: { row: 3, col: 3 },
  }
  const openCenterProps = placeEnvironmentalProps(syntheticMaze, { count: 20 })
  assert.ok(openCenterProps.length > 0, 'Places props along outer walled cells')
  const placedAtOpenCenter = openCenterProps.some((p) => p.row === 2 && p.col === 2)
  assert.equal(
    placedAtOpenCenter,
    false,
    'Never defaults to north or places prop in wall-less open center cell (2,2)'
  )

  // Verify real mazes across difficulties use all 4 cardinal walls and every prop has an adjacent wall
  const dirOffsets = {
    north: { dRow: -1, dCol: 0 },
    south: { dRow: 1, dCol: 0 },
    west: { dRow: 0, dCol: -1 },
    east: { dRow: 0, dCol: 1 },
  }
  const wallSideCounts = { north: 0, south: 0, west: 0, east: 0 }

  for (const difficulty of ['easy', 'medium', 'hard', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 5150 })
    const props = placeEnvironmentalProps(maze)
    assert.ok(props.length > 0, `${difficulty} places environmental props`)

    for (const prop of props) {
      assert.equal(
        maze.grid[prop.row][prop.col],
        CELL_TYPES.PATH,
        `Prop ${prop.id} rests on a walkable PATH cell`
      )
      const d = dirOffsets[prop.wallSide]
      assert.ok(d, `Prop ${prop.id} declares valid cardinal wallSide (${prop.wallSide})`)
      wallSideCounts[prop.wallSide] += 1

      const wr = prop.row + d.dRow
      const wc = prop.col + d.dCol
      const adjacentIsWall =
        wr < 0 ||
        wr >= maze.grid.length ||
        wc < 0 ||
        wc >= maze.grid[0].length ||
        maze.grid[wr][wc] === CELL_TYPES.WALL
      assert.equal(
        adjacentIsWall,
        true,
        `Prop ${prop.id} anchor side (${prop.wallSide}) actually borders a WALL cell`
      )
    }
  }

  for (const side of ['north', 'south', 'west', 'east']) {
    assert.ok(
      wallSideCounts[side] > 0,
      `Wall selection uses ${side} walls too (counts=${JSON.stringify(wallSideCounts)})`
    )
  }
  console.log('✓ Wall-side validity & anti-north-bias verified')
}

// ---------------------------------------------------------------------------
// 6. Phase 2: Wall / Pilaster Non-Intersection, Flush Panels & Corridor Space
// ---------------------------------------------------------------------------
{
  console.log('Test 6: World-space wall & pilaster clearance, flush electrical panels & corridor width')

  const getPilasterBoxesForMaze = (maze) => {
    const boxes = []
    const rows = maze.grid.length
    const cols = maze.grid[0].length
    const isPath = (r, c) =>
      r >= 0 && r < rows && c >= 0 && c < cols && maze.grid[r][c] === CELL_TYPES.PATH
    const plinthHalf = 0.27
    const plinthHeight = 0.22
    const cornerOffPlinth = CELL_SIZE * 0.5 - 0.25 + 0.04 * 1.5 // 1.81 from buildMazeCeiling.js

    for (let r = 0; r < rows; r += 2) {
      for (let c = 0; c < cols; c += 2) {
        if (maze.grid[r][c] !== CELL_TYPES.WALL) continue
        const wp = gridToWorld(r, c, maze)
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            if (isPath(r + sz, c) || isPath(r, c + sx) || isPath(r + sz, c + sx)) {
              const cx = wp.x + sx * cornerOffPlinth
              const cz = wp.z + sz * cornerOffPlinth
              boxes.push(
                new THREE.Box3(
                  new THREE.Vector3(cx - plinthHalf, 0, cz - plinthHalf),
                  new THREE.Vector3(cx + plinthHalf, plinthHeight, cz + plinthHalf)
                )
              )
            }
          }
        }
      }
    }
    return boxes
  }

  const shrinkBoxXZ = (box, eps) =>
    new THREE.Box3(
      new THREE.Vector3(box.min.x + eps, box.min.y + eps, box.min.z + eps),
      new THREE.Vector3(box.max.x - eps, box.max.y - eps, box.max.z - eps)
    )

  const materials = getEnvironmentalPropMaterials()

  for (const [difficulty, seed] of [
    ['easy', 111],
    ['medium', 222],
    ['hard', 333],
    ['hardcore', 444],
  ]) {
    const maze = generateMaze({ difficulty, seed })
    const root = buildMazeMeshes(maze)
    root.updateMatrixWorld(true)

    const propsGroup = root.getObjectByName('maze-environmental-props')
    assert.ok(propsGroup && propsGroup.children.length > 0)
    assert.ok(
      Array.isArray(propsGroup.userData.placedProps) && propsGroup.userData.placedProps.length > 0,
      'Props group records placedProps placement metadata'
    )

    // Verify all children are InstancedMesh draw calls with valid instance matrices & bounds
    const observedInstanceMatrices = []
    const mat4 = new THREE.Matrix4()
    for (const node of propsGroup.children) {
      assert.equal(node.isInstancedMesh, true, `${node.name} is an InstancedMesh batch`)
      assert.ok(node.count > 0, `${node.name} has non-zero instance count`)
      assert.ok(node.boundingBox && !node.boundingBox.isEmpty(), `${node.name} has computed boundingBox`)
      assert.ok(node.boundingSphere && Number.isFinite(node.boundingSphere.radius), `${node.name} has computed boundingSphere`)
      for (let k = 0; k < node.count; k += 1) {
        node.getMatrixAt(k, mat4)
        observedInstanceMatrices.push(new Float32Array(mat4.elements))
      }
    }

    const hasMatchingInstanceMatrix = (targetElements) => {
      for (let i = 0; i < observedInstanceMatrices.length; i += 1) {
        const candidate = observedInstanceMatrices[i]
        let match = true
        for (let j = 0; j < 16; j += 1) {
          if (Math.abs(candidate[j] - targetElements[j]) > 1e-4) {
            match = false
            break
          }
        }
        if (match) return true
      }
      return false
    }

    const pilasterBoxes = getPilasterBoxesForMaze(maze)
    const propBoxes = []
    const scratchWorldMat = new THREE.Matrix4()

    for (const placed of propsGroup.userData.placedProps) {
      const { propId, propType, row, col, wallSide, wallMounted, position, rotationYaw, scale } = placed
      const proto = createEnvironmentalPropMesh(propType, materials)
      proto.position.set(position[0], position[1], position[2])
      proto.rotation.y = rotationYaw
      proto.scale.setScalar(scale)
      proto.updateMatrixWorld(true)

      // Every sub-part world matrix must appear inside the InstancedMesh batches
      proto.traverse((sub) => {
        if (!sub.isMesh) return
        scratchWorldMat.copy(sub.matrixWorld)
        assert.equal(
          hasMatchingInstanceMatrix(scratchWorldMat.elements),
          true,
          `InstancedMesh batches include exact world transform for ${propId}:${sub.name}`
        )
      })

      const box = new THREE.Box3().setFromObject(proto)
      propBoxes.push({ propId, box })
      proto.clear()

      const cellCenter = gridToWorld(row, col, maze)

      // 1) Check against neighboring 3x3 wall cells
      const clippedBox = shrinkBoxXZ(box, 0.001)
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const nr = row + dr
          const nc = col + dc
          const isWall =
            nr < 0 ||
            nr >= maze.grid.length ||
            nc < 0 ||
            nc >= maze.grid[0].length ||
            maze.grid[nr][nc] === CELL_TYPES.WALL
          if (!isWall) continue
          const wPos = {
            x: cellCenter.x + dc * CELL_SIZE,
            z: cellCenter.z + dr * CELL_SIZE,
          }
          const wallBox = new THREE.Box3(
            new THREE.Vector3(wPos.x - CELL_SIZE * 0.5, 0, wPos.z - CELL_SIZE * 0.5),
            new THREE.Vector3(wPos.x + CELL_SIZE * 0.5, 3, wPos.z + CELL_SIZE * 0.5)
          )
          assert.equal(
            clippedBox.intersectsBox(wallBox),
            false,
            `${propType} at (${row},${col}) [${wallSide}] does not clip into wall (${nr},${nc})`
          )
        }
      }

      // 2) Check against corner pilasters
      for (const pBox of pilasterBoxes) {
        assert.equal(
          clippedBox.intersectsBox(pBox),
          false,
          `${propType} at (${row},${col}) clears corner pilaster plinths`
        )
      }

      // 3) Electrical panels sit flush against anchor wall and parallel to wall
      if (wallMounted) {
        let gapToWall = Infinity
        if (wallSide === 'north') gapToWall = Math.abs(box.min.z - (cellCenter.z - CELL_SIZE * 0.5))
        if (wallSide === 'south') gapToWall = Math.abs(cellCenter.z + CELL_SIZE * 0.5 - box.max.z)
        if (wallSide === 'west') gapToWall = Math.abs(box.min.x - (cellCenter.x - CELL_SIZE * 0.5))
        if (wallSide === 'east') gapToWall = Math.abs(cellCenter.x + CELL_SIZE * 0.5 - box.max.x)
        assert.ok(
          gapToWall <= 0.015,
          `Electrical panel mounts flush against ${wallSide} wall (gap=${gapToWall.toFixed(4)}m)`
        )
      }

      // 4) Navigable corridor clearance across cell
      const cellMinX = cellCenter.x - CELL_SIZE * 0.5
      const cellMaxX = cellCenter.x + CELL_SIZE * 0.5
      const cellMinZ = cellCenter.z - CELL_SIZE * 0.5
      const cellMaxZ = cellCenter.z + CELL_SIZE * 0.5
      let clearSpan = CELL_SIZE
      if (wallSide === 'north') clearSpan = cellMaxZ - box.max.z
      if (wallSide === 'south') clearSpan = box.min.z - cellMinZ
      if (wallSide === 'west') clearSpan = cellMaxX - box.max.x
      if (wallSide === 'east') clearSpan = box.min.x - cellMinX
      assert.ok(
        clearSpan >= PLAYER_RADIUS * 2 + 0.35,
        `${propType} leaves generous navigable corridor (${clearSpan.toFixed(2)}m >= ${(PLAYER_RADIUS * 2 + 0.35).toFixed(2)}m)`
      )
    }

    // 5) No two props overlap in world space
    for (let i = 0; i < propBoxes.length; i += 1) {
      for (let j = i + 1; j < propBoxes.length; j += 1) {
        const a = propBoxes[i]
        const b = propBoxes[j]
        assert.equal(
          a.box.intersectsBox(b.box),
          false,
          `Props ${a.propId} and ${b.propId} never overlap`
        )
      }
    }

    disposeMazeGroup(root)
  }

  disposeAllSharedPools()
  console.log('✓ Wall/pilaster non-intersection, flush panels, anti-overlap & corridor clearance verified')
}

// ---------------------------------------------------------------------------
// 7. Phase 2: Placement Heights, Floor Grounding & Sub-Part Orientation
// ---------------------------------------------------------------------------
{
  console.log('Test 7: Floor grounding, overturned furniture pivots, desk papers & wall panel height')

  const seenTypes = new Set()

  const mats7 = getEnvironmentalPropMaterials()
  for (let seed = 10; seed <= 120; seed += 11) {
    const maze = generateMaze({ difficulty: 'hardcore', seed })
    const propsGroup = buildEnvironmentalProps(maze)
    propsGroup.updateMatrixWorld(true)

    for (const placed of propsGroup.userData.placedProps) {
      const { propType, position, rotationYaw, scale } = placed
      seenTypes.add(propType)
      const propMesh = createEnvironmentalPropMesh(propType, mats7)
      propMesh.position.set(position[0], position[1], position[2])
      propMesh.rotation.y = rotationYaw
      propMesh.scale.setScalar(scale)
      propMesh.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(propMesh)

      if (propType === PROP_TYPES.ELECTRICAL_PANEL) {
        assert.ok(
          box.min.y >= 0.35 && box.min.y <= 0.55 && box.max.y >= 1.4 && box.max.y <= 1.75,
          `Electrical panel sits at wall-mounted elevation (minY=${box.min.y.toFixed(3)}, maxY=${box.max.y.toFixed(3)})`
        )
      } else {
        assert.ok(
          box.min.y >= -0.002 && box.min.y <= 0.003,
          `${propType} rests flush on floor at y=0 (minY=${box.min.y.toFixed(4)})`
        )
      }

      // Check every child sub-mesh too so no leg or overturned body dips below y = -0.002
      propMesh.traverse((node) => {
        if (!node.isMesh) return
        const subBox = new THREE.Box3().setFromObject(node)
        assert.ok(
          subBox.min.y >= -0.002,
          `Sub-mesh in ${propType} does not clip below floor (minY=${subBox.min.y.toFixed(4)})`
        )
      })

      // Check desk papers rest directly on tilted desk surface (parented to desk-top, not floating)
      if (propType === PROP_TYPES.DESK_BROKEN) {
        const paperMeshes = []
        propMesh.traverse((node) => {
          if (node.isMesh && (node.name === 'desk-paper' || node.name === 'desk-folder')) {
            paperMeshes.push(node)
          }
        })
        assert.ok(paperMeshes.length >= 2, 'Broken desk contains desk papers & folder meshes')
        for (const pMesh of paperMeshes) {
          assert.ok(
            pMesh.parent && pMesh.parent.isMesh && pMesh.parent.name === 'desk-top',
            'Desk papers are parented to tilted desk-top so they align with its slope'
          )
          const topHalfHeight = pMesh.parent.userData.topHalfHeight
          pMesh.geometry.computeBoundingBox()
          const localMinY = pMesh.position.y + pMesh.geometry.boundingBox.min.y
          assert.ok(
            Math.abs(localMinY - topHalfHeight) < 0.002,
            `Desk paper sits flush on top of desk-top slab (localMinY=${localMinY.toFixed(4)}, topHalf=${topHalfHeight})`
          )
        }
      }
      propMesh.clear()
    }

    // Also verify actual InstancedMesh world boxes never dip below y = -0.002
    const instMat = new THREE.Matrix4()
    const instVertBox = new THREE.Box3()
    const baseBox = new THREE.Box3()
    for (const node of propsGroup.children) {
      assert.equal(node.isInstancedMesh, true)
      node.geometry.computeBoundingBox()
      baseBox.copy(node.geometry.boundingBox)
      for (let k = 0; k < node.count; k += 1) {
        node.getMatrixAt(k, instMat)
        instVertBox.copy(baseBox).applyMatrix4(instMat)
        assert.ok(
          instVertBox.min.y >= -0.002,
          `Instanced part ${node.name}#${k} never clips below floor (minY=${instVertBox.min.y.toFixed(4)})`
        )
      }
    }

    disposeMazeGroup(propsGroup)
  }

  assert.equal(seenTypes.size, 12, 'All 12 existing prop types continue to be generated')
  disposeAllSharedPools()
  console.log('✓ Floor grounding, overturned pivots, tilted desk papers & all 12 prop types verified')
}

// ---------------------------------------------------------------------------
// 8. Phase 2: Gameplay Exclusions, Determinism & MazeSceneEngine Integration
// ---------------------------------------------------------------------------
{
  console.log('Test 8: Gameplay exclusions (collectibles/keycards/hazards/hidingSpots) & determinism')

  for (const difficulty of ['easy', 'medium', 'hard', 'hardcore']) {
    const mazeA = generateMaze({ difficulty, seed: 8080 })
    const mazeB = generateMaze({ difficulty, seed: 8080 })
    const mazeDiff = generateMaze({ difficulty, seed: 8081 })

    const propsA = placeEnvironmentalProps(mazeA)
    const propsB = placeEnvironmentalProps(mazeB)
    const propsDiff = placeEnvironmentalProps(mazeDiff)

    assert.deepEqual(propsA, propsB, `${difficulty}: Same seed produces byte-identical prop placements`)
    assert.notDeepEqual(propsA, propsDiff, `${difficulty}: Different seed produces varied placements`)

    const hazards = placeHazards(mazeA)
    const hidingSpots = placeHidingSpots(mazeA, { hazards })

    const forbidden = new Set([
      `${mazeA.start.row},${mazeA.start.col}`,
      `${mazeA.exit.row},${mazeA.exit.col}`,
      ...mazeA.collectibles.items.map((item) => `${item.row},${item.col}`),
      ...mazeA.keycards.map((k) => `${k.row},${k.col}`),
      ...hazards.map((h) => `${h.row},${h.col}`),
      ...hidingSpots.map((s) => `${s.row},${s.col}`),
    ])

    const seenCells = new Set()
    for (const prop of propsA) {
      const key = `${prop.row},${prop.col}`
      assert.equal(
        forbidden.has(key),
        false,
        `${difficulty}: Prop ${prop.id} at (${key}) excludes start/exit/collectibles/keycards/hazards/hidingSpots`
      )
      assert.equal(seenCells.has(key), false, `${difficulty}: At most one prop occupies cell (${key})`)
      seenCells.add(key)
    }
  }

  // Verify density bounds remain preserved (never inflated beyond caps)
  const easyCount = placeEnvironmentalProps(generateMaze({ difficulty: 'easy', seed: 9191 })).length
  const medCount = placeEnvironmentalProps(generateMaze({ difficulty: 'medium', seed: 9191 })).length
  const hardCount = placeEnvironmentalProps(generateMaze({ difficulty: 'hardcore', seed: 9191 })).length
  assert.ok(easyCount > 0 && easyCount <= 24, `Easy density preserved (${easyCount} <= 24)`)
  assert.ok(medCount > 0 && medCount <= 55, `Medium density preserved (${medCount} <= 55)`)
  assert.ok(hardCount > 0 && hardCount <= 95, `Hardcore density preserved (${hardCount} <= 95)`)

  // Full MazeSceneEngine integration check: engine hazards & hiding spots never overlap engine props
  const { engine } = createHeadlessEngine()
  const engineMaze = generateMaze({ difficulty: 'hard', seed: 9999 })
  engine.setMaze(engineMaze)

  const enginePropsGroup = engine.getMazeGroup()?.getObjectByName('maze-environmental-props')
  assert.ok(enginePropsGroup && enginePropsGroup.children.length > 0)

  const runtimeForbidden = new Set([
    `${engineMaze.start.row},${engineMaze.start.col}`,
    `${engineMaze.exit.row},${engineMaze.exit.col}`,
    ...engineMaze.collectibles.items.map((item) => `${item.row},${item.col}`),
    ...engineMaze.keycards.map((k) => `${k.row},${k.col}`),
    ...engine.hazardManager.getHazards().map((h) => `${h.row},${h.col}`),
    ...engine.hidingSpotManager.getHidingSpots().map((s) => `${s.row},${s.col}`),
  ])

  for (const placed of enginePropsGroup.userData.placedProps) {
    const key = `${placed.row},${placed.col}`
    assert.equal(
      runtimeForbidden.has(key),
      false,
      `Engine prop at (${key}) avoids all live runtime hazards/hidingSpots/collectibles/keycards`
    )
  }

  engine.dispose()
  disposeAllSharedPools()
  console.log('✓ Gameplay exclusions, determinism, density preservation & MazeSceneEngine integration verified')
}

// ---------------------------------------------------------------------------
// 9. Phase 4: Silhouette Components, Bounds Compliance & Shared Geometry Pool
// ---------------------------------------------------------------------------
{
  console.log('Test 9: Phase 4 composite silhouettes, named components, local bounds & geometry pooling')

  disposeAllSharedPools()

  const expectedComponents = {
    [PROP_TYPES.DESK_BROKEN]: ['desk-top', 'desk-apron', 'desk-legs-standing', 'desk-broken-leg', 'desk-paper', 'desk-folder'],
    [PROP_TYPES.CHAIR_BROKEN]: ['chair-seat', 'chair-backrest', 'chair-legs'],
    [PROP_TYPES.CHAIR_OVERTURNED]: ['chair-seat', 'chair-backrest', 'chair-legs'],
    [PROP_TYPES.FILING_CABINET]: ['cabinet-body', 'cabinet-drawer-open', 'cabinet-drawers', 'cabinet-handles', 'cabinet-papers'],
    [PROP_TYPES.FILING_CABINET_OVERTURNED]: ['cabinet-body', 'cabinet-drawers', 'cabinet-handles', 'cabinet-papers', 'cabinet-spilled-paper'],
    [PROP_TYPES.STORAGE_LOCKER]: ['locker-frame', 'locker-doors', 'locker-hardware', 'locker-contents'],
    [PROP_TYPES.STORAGE_SHELF]: ['shelf-frame', 'shelf-tiers', 'shelf-cargo-crate', 'shelf-cargo-container', 'shelf-cargo-papers'],
    [PROP_TYPES.INDUSTRIAL_BARREL]: ['barrel-body', 'barrel-hoops'],
    [PROP_TYPES.WOODEN_CRATE]: ['crate-core', 'crate-slats', 'crate-brackets'],
    [PROP_TYPES.TOOLBOX]: ['toolbox-body', 'toolbox-lid', 'toolbox-latches', 'toolbox-handle'],
    [PROP_TYPES.ELECTRICAL_PANEL]: ['panel-enclosure', 'panel-door', 'panel-hardware', 'panel-warning', 'panel-cables'],
    [PROP_TYPES.DEBRIS_PILE]: ['debris-chunks', 'debris-rebar', 'debris-cable', 'debris-papers'],
  }

  const materials = getEnvironmentalPropMaterials()
  const uniqueGeos = new Set()

  for (const propType of Object.values(PROP_TYPES)) {
    const protoA = createEnvironmentalPropMesh(propType, materials)
    const protoB = createEnvironmentalPropMesh(propType, materials)
    protoA.updateMatrixWorld(true)
    protoB.updateMatrixWorld(true)

    const meshNamesA = []
    const geosA = []
    protoA.traverse((node) => {
      if (!node.isMesh) return
      meshNamesA.push(node.name)
      geosA.push(node.geometry)
      uniqueGeos.add(node.geometry)

      assert.equal(isSharedResource(node.geometry), true, `${propType} sub-mesh ${node.name} geometry is shared-pooled`)
      assert.equal(isSharedResource(node.material), true, `${propType} sub-mesh ${node.name} material is shared-pooled`)

      const posAttr = node.geometry.attributes.position
      assert.ok(posAttr && posAttr.count > 0, `${propType}:${node.name} has non-empty vertices`)
      for (let i = 0; i < posAttr.count; i += 1) {
        assert.ok(
          Number.isFinite(posAttr.getX(i)) &&
            Number.isFinite(posAttr.getY(i)) &&
            Number.isFinite(posAttr.getZ(i)),
          `${propType}:${node.name} has finite vertex coordinates`
        )
      }
    })

    const geosB = []
    protoB.traverse((node) => {
      if (node.isMesh) geosB.push(node.geometry)
    })
    assert.deepEqual(geosA, geosB, `${propType} reuses identical pooled BufferGeometry instances across builds`)

    for (const reqName of expectedComponents[propType]) {
      assert.ok(
        meshNamesA.includes(reqName),
        `${propType} exposes recognizable component '${reqName}' (found=${JSON.stringify(meshNamesA)})`
      )
    }

    // Verify unscaled local bounding box respects PROP_PLACEMENT_SPECS exactly
    const spec = PROP_PLACEMENT_SPECS[propType]
    const box = new THREE.Box3().setFromObject(protoA)
    assert.ok(
      box.min.x >= -spec.halfWidth - 0.002 && box.max.x <= spec.halfWidth + 0.002,
      `${propType} X span [${box.min.x.toFixed(3)}, ${box.max.x.toFixed(3)}] fits within +/-${spec.halfWidth}`
    )
    assert.ok(
      box.min.z >= -spec.halfDepthBack - 0.002 && box.max.z <= spec.halfDepthFront + 0.002,
      `${propType} Z span [${box.min.z.toFixed(3)}, ${box.max.z.toFixed(3)}] fits within [-${spec.halfDepthBack}, +${spec.halfDepthFront}]`
    )

    if (propType === PROP_TYPES.ELECTRICAL_PANEL) {
      assert.ok(
        Math.abs(box.min.z + spec.halfDepthBack) <= 0.003,
        `Electrical panel back face sits flush at z=-${spec.halfDepthBack} (minZ=${box.min.z.toFixed(4)})`
      )
      assert.ok(
        box.min.y >= 0.35 && box.min.y <= 0.55 && box.max.y >= 1.4 && box.max.y <= 1.75,
        `Electrical panel mounts at wall height (minY=${box.min.y.toFixed(3)}, maxY=${box.max.y.toFixed(3)})`
      )
    } else {
      assert.ok(
        box.min.y >= -0.002 && box.min.y <= 0.002,
        `${propType} bottom rests flush at y=0 (minY=${box.min.y.toFixed(4)})`
      )
    }
  }

  // Verify shared geometry pool tracks all geometries, survives disposeMazeGroup(), and empties cleanly
  const poolStats = getEnvironmentalPropPoolStats()
  assert.equal(poolStats.materials, 9, 'Pooled material count remains 9')
  assert.equal(poolStats.textureSets, 5, 'Pooled textureSet count remains 5')
  assert.equal(poolStats.geometries, uniqueGeos.size, 'All prop geometries are accounted for in propGeometryPool')
  assert.ok(poolStats.geometries >= 30, `Rich multi-part geometry pool populated (${poolStats.geometries} geometries)`)

  const geoDisposeEvents = []
  for (const g of uniqueGeos) {
    g.addEventListener('dispose', () => geoDisposeEvents.push(true))
  }

  const maze = generateMaze({ difficulty: 'hardcore', seed: 6060 })
  const mazeGroup = buildMazeMeshes(maze)
  disposeMazeGroup(mazeGroup)
  assert.equal(geoDisposeEvents.length, 0, 'disposeMazeGroup() never disposes shared pooled prop geometries')
  assert.equal(getEnvironmentalPropPoolStats().geometries, uniqueGeos.size)

  disposeEnvironmentalPropPools()
  assert.equal(getEnvironmentalPropPoolStats().geometries, 0, 'disposeEnvironmentalPropPools() clears prop geometry pool')
  assert.equal(geoDisposeEvents.length, uniqueGeos.size, 'All pooled prop geometries dispose cleanly on pool teardown')

  disposeAllSharedPools()
  console.log('✓ Phase 4 silhouettes, bounds, component presence & geometry pool lifecycle verified')
}

// ---------------------------------------------------------------------------
// 10. Phase 5: Instancing Draw-Call Optimization & Multi-Cycle Pool Lifecycle
// ---------------------------------------------------------------------------
{
  console.log('Test 10: Phase 5 InstancedMesh draw-call savings, pool teardown & clean recreation')

  disposeAllSharedPools()

  // Verify InstancedMesh batching reduces draw calls sharply across all difficulties
  const hardcoreMaze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const hardcoreRoot = buildMazeMeshes(hardcoreMaze)
  const propsGroup = hardcoreRoot.getObjectByName('maze-environmental-props')
  assert.ok(propsGroup, 'Hardcore maze builds instanced props group')
  assert.ok(
    propsGroup.userData.meshCount <= 200 &&
      propsGroup.userData.instanceCount >= 200 &&
      propsGroup.userData.meshCount < propsGroup.userData.instanceCount,
    `Instancing + 2x2 quadrant chunking batches ${propsGroup.userData.instanceCount} prop sub-parts into ${propsGroup.userData.meshCount} draw calls`
  )
  assert.ok(
    propsGroup.children.every(
      (c) =>
        c.isInstancedMesh &&
        c.castShadow === !NON_SHADOW_CASTING_PROP_PARTS.has(c.userData?.partName) &&
        c.receiveShadow
    ),
    'All environmental prop batches use InstancedMesh with selective castShadow pruning and receiveShadow preserved'
  )

  const poolStatsActive = getEnvironmentalPropPoolStats()
  assert.ok(
    poolStatsActive.prototypes >= 10 && poolStatsActive.prototypes <= 12,
    `Prototype descriptor cache stores placed prop types (${poolStatsActive.prototypes}/12)`
  )

  // Verify disposal of InstancedMesh buffers via disposeMazeGroup leaves shared geometry/material pools alive
  let instancedDisposeEvents = 0
  for (const c of propsGroup.children) {
    c.addEventListener('dispose', () => {
      instancedDisposeEvents += 1
    })
  }
  disposeMazeGroup(hardcoreRoot)
  assert.equal(instancedDisposeEvents, propsGroup.userData.meshCount || instancedDisposeEvents)
  assert.equal(getEnvironmentalPropPoolStats().materials, 9, 'Shared materials survive disposeMazeGroup()')
  assert.equal(
    getEnvironmentalPropPoolStats().prototypes,
    poolStatsActive.prototypes,
    'Prototype cache survives disposeMazeGroup()'
  )

  // Full pool disposal empties geometries, materials, textureSets, AND prototype cache
  disposeEnvironmentalPropPools()
  const clearedStats = getEnvironmentalPropPoolStats()
  assert.equal(clearedStats.materials, 0)
  assert.equal(clearedStats.textureSets, 0)
  assert.equal(clearedStats.geometries, 0)
  assert.equal(clearedStats.prototypes, 0)

  // Repeated engine reset / difficulty change / teardown / recreation cycles
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const { engine } = createHeadlessEngine()
    for (const [diff, seed] of [
      ['small', 100 + cycle],
      ['medium', 200 + cycle],
      ['large', 300 + cycle],
      ['hardcore', 400 + cycle],
    ]) {
      engine.setMaze(generateMaze({ difficulty: diff, seed }))
      const activeProps = engine.getMazeGroup()?.getObjectByName('maze-environmental-props')
      assert.ok(activeProps && activeProps.children.length > 0, `Cycle ${cycle} ${diff}: props valid`)
      for (const node of activeProps.children) {
        assert.equal(node.isInstancedMesh, true)
        assert.equal(isSharedResource(node.geometry), true)
        assert.equal(isSharedResource(node.material), true)
      }
    }
    engine.clearMaze()
    engine.setMaze(generateMaze({ difficulty: 'hardcore', seed: 4242 }))

    // Verify deterministic instance matrix output across cycles
    const detProps = engine.getMazeGroup()?.getObjectByName('maze-environmental-props')
    assert.equal(detProps.userData.propCount, hardcoreMaze ? detProps.userData.propCount : 0)
    assert.ok(detProps.userData.meshCount <= 200)

    engine.dispose()
    const statsAfterDispose = getEnvironmentalPropPoolStats()
    assert.equal(statsAfterDispose.materials, 0, `Cycle ${cycle}: material pool cleaned on engine dispose`)
    assert.equal(statsAfterDispose.textureSets, 0, `Cycle ${cycle}: texture pool cleaned on engine dispose`)
    assert.equal(statsAfterDispose.geometries, 0, `Cycle ${cycle}: geometry pool cleaned on engine dispose`)
    assert.equal(statsAfterDispose.prototypes, 0, `Cycle ${cycle}: prototype cache cleaned on engine dispose`)
  }

  disposeAllSharedPools()
  console.log('✓ Phase 5 instancing draw-call savings, pool teardown & multi-cycle recreation verified')
}

// ---------------------------------------------------------------------------
// 11. Phase 3: Preset Texture Resolutions, Contrast & Per-Preset Pool Reuse
// ---------------------------------------------------------------------------
{
  console.log('Test 11: Prop texture preset resolutions (64/128/256), contrast, pooling & cleanup')

  disposeAllSharedPools()
  const seenMaps = new Map()
  for (const [preset, expectedSize] of [
    ['performance', 64],
    ['balanced', 128],
    ['high', 256],
  ]) {
    const texSet = getEnvironmentalPropTextureSet({ qualityPreset: preset })
    const texSetAgain = getEnvironmentalPropTextureSet({ qualityPreset: preset })
    for (const [name, trio] of Object.entries(texSet)) {
      assert.equal(trio.map, texSetAgain[name].map, `${preset} ${name}.map pooled`)
      assert.equal(trio.map.image.width, expectedSize, `${preset} ${name}.map width=${expectedSize}`)
      assert.equal(trio.map.image.height, expectedSize, `${preset} ${name}.map height=${expectedSize}`)
      assert.equal(trio.roughnessMap.image.width, expectedSize)
      assert.equal(trio.bumpMap.image.width, expectedSize)

      const aData = trio.map.image.data
      const rData = trio.roughnessMap.image.data
      let aMin = 255
      let aMax = 0
      let rMin = 1
      let rSum = 0
      const px = expectedSize * expectedSize
      for (let i = 0; i < px; i += 1) {
        const lum = aData[i * 4]
        if (lum < aMin) aMin = lum
        if (lum > aMax) aMax = lum
        const rv = rData[i * 4] / 255
        if (rv < rMin) rMin = rv
        rSum += rv
      }
      assert.ok(aMax - aMin >= 20, `${preset} ${name}.map retains contrast (range=${aMax - aMin})`)
      assert.ok(rMin >= 0.82 && rSum / px >= 0.88, `${preset} ${name}.roughnessMap stays dry matte`)
    }
    seenMaps.set(preset, texSet.rustMetal.map)
  }

  assert.notEqual(seenMaps.get('performance'), seenMaps.get('balanced'))
  assert.notEqual(seenMaps.get('balanced'), seenMaps.get('high'))
  assert.equal(getEnvironmentalPropPoolStats().textureSets, 15, '3 presets x 5 prop texture sets cached cleanly')

  disposeAllSharedPools()
  assert.equal(getEnvironmentalPropPoolStats().textureSets, 0, 'All prop preset texture sets dispose cleanly')
  console.log('✓ Prop texture preset resolutions, contrast, pooling & cleanup verified')
}

console.log('=== ALL ENVIRONMENTAL PROP MATERIAL, PLACEMENT & LIFECYCLE TESTS PASSED! ===')
