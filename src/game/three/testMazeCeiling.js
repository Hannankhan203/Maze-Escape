import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE, PLAYER_RADIUS, WALL_HEIGHT, gridToWorld, worldToGrid } from '../world/worldCoords.js'
import { CAMERA_MODES, MAX_THIRD_PERSON_HEIGHT } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { MAZE_CEILING_CONFIG } from './buildMazeCeiling.js'
import { MAZE_MESH_PALETTE, buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { getMazeSurfacePoolStats, getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'
import { getLayerMeshes } from './spatialChunking.js'
import { getBackdropPoolStats } from './undergroundBackdrop.js'

console.log('--- RUNNING FACILITY CEILING & STRUCTURAL PILLAR TESTS ---')

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
// 1. Procedural Ceiling Textures, Shader Modes & Downward Imperfections
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Ceiling concrete textures, shader hooks, roughness & ceiling-only imperfections')

  const t0 = performance.now()
  const surfaceSet = getMazeSurfaceTextureSet()
  const coldGenMs = performance.now() - t0
  assert.ok(coldGenMs < 2000, `Cold surface generation including ceiling stays under budget (${coldGenMs.toFixed(1)}ms)`)

  assert.equal(surfaceSet.ceiling.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(surfaceSet.ceiling.roughnessMap.colorSpace, THREE.NoColorSpace)
  assert.equal(surfaceSet.ceiling.bumpMap.colorSpace, THREE.NoColorSpace)
  assert.equal(surfaceSet.ceiling.map.image.width, 512)
  assert.equal(surfaceSet.ceiling.roughnessMap.image.width, 256)
  assert.equal(surfaceSet.ceiling.bumpMap.image.width, 256)
  assert.equal(isSharedResource(surfaceSet.ceiling.map), true)

  // Verify ceiling roughness stays dry matte mineral concrete
  const rData = surfaceSet.ceiling.roughnessMap.image.data
  const rCount = 256 * 256
  let rMin = 1
  let rSum = 0
  for (let i = 0; i < rCount; i += 1) {
    const val = rData[i * 4] / 255
    if (val < rMin) rMin = val
    rSum += val
  }
  const rAvg = rSum / rCount
  assert.ok(rMin >= 0.84 && rAvg >= 0.9, `Ceiling roughness stays dry matte (min=${rMin.toFixed(2)}, avg=${rAvg.toFixed(2)})`)

  // Verify bump height contrast & formwork seam albedo range
  const cData = surfaceSet.ceiling.map.image.data
  let cMin = 255
  let cMax = 0
  for (let i = 0; i < 512 * 512; i += 1) {
    const l = cData[i * 4]
    if (l < cMin) cMin = l
    if (l > cMax) cMax = l
  }
  assert.ok(cMax - cMin >= 42, `Ceiling albedo contains formwork seam & aggregate contrast (range=${cMax - cMin})`)

  // Verify world-space concrete shader compiles for ceilingMat, beamMat, and pillarMat
  const maze = generateMaze({ difficulty: 'medium', seed: 3030 })
  const group = buildMazeMeshes(maze)
  const groupPerf = buildMazeMeshes(maze, { qualityPreset: 'performance' })
  for (const [label, mat, matPerf] of [
    ['ceilingMat', group.userData.ceilingMat, groupPerf.userData.ceilingMat],
    ['beamMat', group.userData.beamMat, groupPerf.userData.beamMat],
    ['pillarMat', group.userData.pillarMat, groupPerf.userData.pillarMat],
  ]) {
    assert.ok(mat, `${label} exists on maze root`)
    assert.equal(mat.userData.concreteWeatherMode, 'ceiling', `${label} binds ceiling triplanar shader mode`)
    assert.ok(mat.roughness >= 0.94, `${label} maintains matte roughness (${mat.roughness})`)
    assert.ok(mat.metalness <= 0.03, `${label} maintains non-metallic concrete reflectance`)
    assert.equal(mat.userData.concreteWeatherUniforms?.uConcreteDetail?.value, 1.0, `${label} defaults uConcreteDetail to 1.0`)
    assert.equal(matPerf.userData.concreteWeatherUniforms?.uConcreteDetail?.value, 0.0, `${label} sets performance uConcreteDetail to 0.0`)
    assert.equal(mat.customProgramCacheKey(), matPerf.customProgramCacheKey(), `${label} shares program cache key across presets`)

    const mockShader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }
    mat.onBeforeCompile(mockShader)
    assert.ok(mockShader.uniforms.uWeatherSeed !== undefined, `${label} binds uWeatherSeed`)
    assert.ok(mockShader.uniforms.uConcreteDetail !== undefined, `${label} binds uConcreteDetail`)
    assert.ok(mockShader.fragmentShader.includes('uConcreteDetail'), `${label} references uConcreteDetail uniform`)
    assert.ok(mockShader.fragmentShader.includes('cNoise2v2'), `${label} uses paired lattice noise`)
    assert.ok(mockShader.fragmentShader.includes('concreteWorldHeightDelta'), `${label} includes ceiling normal micro-relief`)
    assert.ok(mockShader.fragmentShader.includes('dConcreteWorld'), `${label} computes screen-space concrete bump derivative`)
  }
  disposeMazeGroup(groupPerf)

  // Verify downward-facing ceiling imperfections
  const ceilImp = group.getObjectByName('maze-ceiling-imperfections')
  const ceilImpMeshes = getLayerMeshes(ceilImp)
  assert.ok(ceilImp && ceilImpMeshes.length >= 1, 'Ceiling imperfection overlay layer built')
  const allowedCeilingVariants = new Set([0, 2, 3, 7, 9, 12, 13, 14])
  const p0 = new THREE.Vector3()
  const p1 = new THREE.Vector3()
  const p2 = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const triNorm = new THREE.Vector3()
  const cellVariantMap = new Map()
  let inspectedDecals = 0

  for (const impMesh of ceilImpMeshes) {
    assert.equal(impMesh.castShadow, false, `${impMesh.name} never casts directional shadows`)
    assert.equal(impMesh.receiveShadow, true, `${impMesh.name} responds to flashlight/light`)
    const posAttr = impMesh.geometry.attributes.position
    const normAttr = impMesh.geometry.attributes.normal
    const variants = impMesh.userData.variantIndices
    const localCount = impMesh.userData.decalCount
    inspectedDecals += localCount

    for (let i = 0; i < localCount; i += 1) {
      assert.ok(allowedCeilingVariants.has(variants[i]), `Ceiling variant #${variants[i]} is ceiling-appropriate (no footprints)`)
      const v0 = i * 4
      p0.fromBufferAttribute(posAttr, v0)
      p1.fromBufferAttribute(posAttr, v0 + 1)
      p2.fromBufferAttribute(posAttr, v0 + 2)
      e1.subVectors(p1, p0)
      e2.subVectors(p2, p0)
      triNorm.crossVectors(e1, e2).normalize()
      assert.ok(triNorm.y < -0.99 && normAttr.getY(v0) === -1, `Ceiling imperfection #${i} faces strictly downward -Y`)
      assert.ok(p0.y > WALL_HEIGHT + 0.5, `Ceiling imperfection #${i} sits flush below soffit (${p0.y.toFixed(3)}m)`)

      const center = new THREE.Vector3().addVectors(p0, p2).multiplyScalar(0.5)
      const cell = worldToGrid(center.x, center.z, maze)
      assert.ok(cell && maze.grid[cell.row][cell.col] === CELL_TYPES.PATH, 'Ceiling imperfection sits over corridor bay')
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue
          assert.notEqual(
            cellVariantMap.get(`${cell.row + dr},${cell.col + dc}`),
            variants[i],
            'Adjacent ceiling bays do not repeat identical imperfection variant'
          )
        }
      }
      cellVariantMap.set(`${cell.row},${cell.col}`, variants[i])
    }
  }
  assert.equal(inspectedDecals, ceilImp.userData.decalCount, 'Chunked ceiling imperfection counts sum cleanly')

  disposeMazeGroup(group)
  disposeAllSharedPools()
  console.log('✓ Ceiling procedural material, shader hooks & ceiling-specific imperfections verified')
}

// ---------------------------------------------------------------------------
// 2. Coverage, Wall Seal, Thickness, Headroom & Corridor Non-Obstruction Across All Difficulties
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Ceiling coverage, wall connection, headroom & corridor clearance across all 4 difficulties')

  // Actor & camera vertical bounds that ceiling beams/capitals must clear cleanly
  const BRUTE_MAX_HEIGHT = 2.15 * 1.24 // 2.666m
  const EXIT_GATE_TOP_Y = 2.91
  const WALL_OUTLINE_TOP_Y = WALL_HEIGHT + 0.012
  const MIN_REQUIRED_CLEARANCE = Math.max(
    1.8,
    BRUTE_MAX_HEIGHT,
    MAX_THIRD_PERSON_HEIGHT,
    EXIT_GATE_TOP_Y,
    WALL_OUTLINE_TOP_Y
  )

  getMazeSurfaceTextureSet()

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 5150 })
    const t0 = performance.now()
    const group = buildMazeMeshes(maze)
    const buildMs = performance.now() - t0
    assert.ok(buildMs < 500, `buildMazeMeshes(${difficulty}) stays under 500ms with ceiling (${buildMs.toFixed(1)}ms)`)

    // Keep instanced wall & cap contract (single on small, spatially chunked on larger mazes)
    const wallMeshes = getLayerMeshes(group.getObjectByName('maze-walls'))
    const capMeshes = getLayerMeshes(group.getObjectByName('maze-wall-caps'))
    assert.ok(
      wallMeshes.length >= 1 &&
        wallMeshes.every((m) => m.isInstancedMesh) &&
        capMeshes.length >= 1 &&
        capMeshes.every((m) => m.isInstancedMesh),
      `${difficulty} preserves InstancedMesh wall & cap layers`
    )

    const ceilingGroup = group.getObjectByName('maze-ceiling-group')
    const deckNode = group.getObjectByName('maze-ceiling-deck')
    const deckMeshes = getLayerMeshes(deckNode)
    const beamsNode = group.getObjectByName('maze-ceiling-beams')
    const pillarsNode = group.getObjectByName('maze-ceiling-pillars')
    const beamsMeshes = getLayerMeshes(beamsNode)
    const pillarsMeshes = getLayerMeshes(pillarsNode)
    assert.ok(
      ceilingGroup && deckMeshes.length > 0 && beamsMeshes.length > 0 && pillarsMeshes.length > 0,
      `All ceiling components built on ${difficulty}`
    )

    // Concrete beams & pilasters cast realistic overhead shadows while top slab stays non-casting
    for (const mesh of deckMeshes) {
      assert.equal(mesh.castShadow, false, `${mesh.name} preserves interior lighting without top-slab blocking`)
      assert.equal(mesh.receiveShadow, true, `${mesh.name} receives flashlight/overhead shadows`)
    }
    for (const mesh of beamsMeshes) {
      assert.equal(mesh.castShadow, true, `${mesh.name} casts structural overhead beam shadows`)
      assert.equal(mesh.receiveShadow, true, `${mesh.name} receives flashlight/overhead shadows`)
    }
    for (const mesh of pillarsMeshes) {
      assert.equal(mesh.castShadow, true, `${mesh.name} casts structural pilaster shadows`)
      assert.equal(mesh.receiveShadow, true, `${mesh.name} receives flashlight/overhead shadows`)
    }

    const halfW = (maze.cols * CELL_SIZE) * 0.5
    const halfD = (maze.rows * CELL_SIZE) * 0.5

    // 2a. Continuous coverage & perimeter enclosure connecting smoothly to outer walls
    const deckBox = new THREE.Box3()
    for (const dm of deckMeshes) {
      dm.geometry.computeBoundingBox()
      deckBox.union(dm.geometry.boundingBox)
    }
    assert.ok(
      deckBox.min.x <= -halfW - 0.5 &&
        deckBox.max.x >= halfW + 0.5 &&
        deckBox.min.z <= -halfD - 0.5 &&
        deckBox.max.z >= halfD + 0.5,
      `Ceiling slab overhangs full ${difficulty} maze footprint with zero sky gaps`
    )
    assert.ok(
      deckBox.min.y <= WALL_HEIGHT && deckBox.min.y >= MAZE_CEILING_CONFIG.spandrelBottomY - 0.01,
      `Perimeter spandrel meets outer walls cleanly at y=${deckBox.min.y.toFixed(2)}m (WALL_HEIGHT=${WALL_HEIGHT}m)`
    )
    assert.ok(
      deckBox.max.y - MAZE_CEILING_CONFIG.soffitY >= MAZE_CEILING_CONFIG.slabThickness,
      `Ceiling structure carries heavy thickness (${(deckBox.max.y - MAZE_CEILING_CONFIG.soffitY).toFixed(2)}m)`
    )

    // 2b. Verify zero deck triangles dip below 3.59m anywhere over playable PATH cells (full soffit headroom)
    for (const dm of deckMeshes) {
      const deckPos = dm.geometry.attributes.position
      for (let v = 0; v < deckPos.count; v += 3) {
        const x = deckPos.getX(v)
        const y = deckPos.getY(v)
        const z = deckPos.getZ(v)
        if (y < MAZE_CEILING_CONFIG.soffitY - 0.05) {
          const cell = worldToGrid(x, z, maze)
          if (cell) {
            assert.equal(
              maze.grid[cell.row][cell.col],
              CELL_TYPES.WALL,
              `Perimeter spandrel drop at (${x.toFixed(1)}, ${z.toFixed(1)}) sits strictly over outer WALL shell`
            )
          }
        }
      }
    }

    // 2c. Primary beams & coffer ribs strictly clear Player, Brute enemy, 3rd-person camera, Exit Gate & wall outlines
    const beamBox = new THREE.Box3()
    for (const bm of beamsMeshes) {
      bm.geometry.computeBoundingBox()
      beamBox.union(bm.geometry.boundingBox)
    }
    assert.ok(
      beamBox.min.y > MIN_REQUIRED_CLEARANCE,
      `Ceiling beam soffit (${beamBox.min.y.toFixed(2)}m) clears Brute/ExitGate/Camera (${MIN_REQUIRED_CLEARANCE.toFixed(2)}m) on ${difficulty}`
    )
    assert.ok(
      beamBox.max.y >= MAZE_CEILING_CONFIG.soffitY - 0.01,
      `Ceiling beams connect flush into slab soffit (${MAZE_CEILING_CONFIG.soffitY}m)`
    )

    // 2d. Structural pilasters visibly connect floor -> beams, while keeping every PATH corridor wide open
    const pillarBox = new THREE.Box3()
    for (const pm of pillarsMeshes) {
      pm.geometry.computeBoundingBox()
      pillarBox.union(pm.geometry.boundingBox)
    }
    assert.ok(
      pillarBox.max.y >= MAZE_CEILING_CONFIG.beamBottomY,
      `Pilaster capitals (${pillarBox.max.y.toFixed(2)}m) connect physically into girders (${MAZE_CEILING_CONFIG.beamBottomY}m)`
    )

    // Verify zero pilaster vertex protrudes within safe corridor clearance zone of any PATH cell
    const safeHalfCorridor = CELL_SIZE * 0.5 - 0.1
    for (const pm of pillarsMeshes) {
      const pilPos = pm.geometry.attributes.position
      for (let v = 0; v < pilPos.count; v += 1) {
        const px = pilPos.getX(v)
        const py = pilPos.getY(v)
        const pz = pilPos.getZ(v)
        if (py >= MAZE_CEILING_CONFIG.pilasterShaftTopY - 1e-3) continue // capitals sit cleanly above 2.75m headroom
        const cell = worldToGrid(px, pz, maze)
        if (!cell || maze.grid[cell.row][cell.col] !== CELL_TYPES.PATH) continue
        const cellCenter = gridToWorld(cell.row, cell.col, maze)
        const dx = Math.abs(px - cellCenter.x)
        const dz = Math.abs(pz - cellCenter.z)
        // Must remain tucked tightly into wall corner within 0.09m of corner edge, clear of player corridor center
        assert.ok(
          Math.max(dx, dz) >= safeHalfCorridor && Math.min(dx, dz) >= 1.5,
          `Pilaster vertex on ${difficulty} stays in wall corner (dx=${dx.toFixed(2)}, dz=${dz.toFixed(2)}) clear of player radius ${PLAYER_RADIUS}`
        )
      }
    }

    assert.ok(group.userData.pilasterCount >= 8, `Maze includes wall-engaged structural pilasters on ${difficulty}`)
    assert.ok(group.userData.exteriorButtressCount >= 8, `Maze includes exterior buttress pillars on ${difficulty}`)

    disposeMazeGroup(group)
  }

  disposeAllSharedPools()
  console.log('✓ Full ceiling coverage, wall seal, structural beams, headroom & corridor clearance verified')
}

// ---------------------------------------------------------------------------
// 3. Engine Lifecycle, Outer Cavern Roof Connection, Presets, Cameras & Disposal
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Outer pillar bases/capitals, upper cavern vault, camera modes, High Contrast & disposal')

  const maze = generateMaze({ difficulty: 'large', seed: 8088 })
  const { engine } = createHeadlessEngine({ cameraMode: CAMERA_MODES.FIRST_PERSON })
  engine.setMaze(maze)

  const backdrop = engine.getEnvironment().details.backdropGroup
  const outerPillars = backdrop.getObjectByName('maze-env-pillars')
  const outerBases = backdrop.getObjectByName('maze-env-pillar-bases')
  const outerCapitals = backdrop.getObjectByName('maze-env-pillar-capitals')
  const upperVault = backdrop.getObjectByName('maze-env-ceiling-vault')

  assert.ok(outerPillars?.isInstancedMesh, 'Outer facility concrete pillars exist')
  assert.ok(outerBases?.isInstancedMesh, 'Outer pillar concrete foundation bases exist')
  assert.ok(outerCapitals?.isInstancedMesh, 'Outer pillar concrete support capitals exist')
  assert.ok(upperVault?.isMesh, 'Upper cavern concrete ceiling vault deck & girders exist')
  assert.equal(upperVault.castShadow, false, 'Upper vault never blocks directional shadows')

  assert.equal(outerBases.count, outerPillars.count, 'Every outer pillar rests on a foundation base')
  assert.equal(outerCapitals.count, outerPillars.count, 'Every outer pillar connects to a ceiling capital')

  // Check outer capital top connects smoothly into upper vault girders
  const mat4 = new THREE.Matrix4()
  outerCapitals.getMatrixAt(0, mat4)
  const capBox = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3().setFromMatrixPosition(mat4),
    new THREE.Vector3().setFromMatrixScale(mat4)
  )
  upperVault.geometry.computeBoundingBox()
  const vaultBox = upperVault.geometry.boundingBox
  assert.ok(
    capBox.max.y >= vaultBox.min.y && capBox.min.y < vaultBox.min.y,
    `Outer pillar capitals (${capBox.min.y.toFixed(2)}..${capBox.max.y.toFixed(2)}m) visibly seat into upper cavern vault (${vaultBox.min.y.toFixed(2)}m)`
  )

  // Verify 1st-person and 3rd-person step + quality presets + High Contrast toggle
  engine.stepFrame(0.016, { render: false })
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.stepFrame(0.016, { render: false })

  const mazeGroup = engine.getMazeGroup()
  engine.setHighContrast(true)
  assert.equal(mazeGroup.getObjectByName('maze-walls-outline')?.visible, true)
  engine.setHighContrast(false)
  assert.equal(mazeGroup.userData.wallMat.color.getHex(), MAZE_MESH_PALETTE.wallBody)

  for (const preset of ['performance', 'balanced', 'high']) {
    engine.updateGraphicsConfig({ qualityPreset: preset })
    const bd = engine.getEnvironment().details.backdropGroup
    assert.ok(bd.getObjectByName('maze-env-ceiling-vault'), `Upper cavern vault persists on ${preset} preset`)
    assert.ok(bd.getObjectByName('maze-env-pillar-capitals'), `Outer pillar capitals persist on ${preset} preset`)
  }

  engine.dispose()
  assert.equal(getMazeSurfacePoolStats().entries, 0, 'Surface texture pool completely disposed')
  assert.equal(getBackdropPoolStats().entries, 0, 'Backdrop pool completely disposed')
  console.log('✓ Outer facility roof support, presets, cameras, High Contrast & clean disposal verified')
}

console.log('=== ALL FACILITY CEILING & STRUCTURAL PILLAR TESTS PASSED! ===')
