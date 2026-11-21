import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE, WALL_HEIGHT, gridToWorld } from '../world/worldCoords.js'
import {
  CEILING_ELECTRICAL_CLEARANCE_MIN_Y,
  CEILING_ELECTRICAL_CONDITIONS,
} from './buildCeilingElectrical.js'
import { getCeilingLightPoolStats } from './buildCeilingLights.js'
import {
  getCeilingVentPoolStats,
  getGalvanizedMetalTextureSet,
} from './buildCeilingVents.js'
import { getEnvironmentalPropTextureSet } from './buildEnvironmentalProps.js'
import { MAZE_CEILING_CONFIG } from './buildMazeCeiling.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { CAMERA_MODES, MAX_THIRD_PERSON_HEIGHT } from './CameraRig.js'
import { HORROR_EVENT_TYPES } from './HorrorDirector.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { getMazeSurfacePoolStats, getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'
import { getLayerMeshes } from './spatialChunking.js'
import { getBackdropPoolStats } from './undergroundBackdrop.js'

console.log('--- RUNNING FACILITY OVERHEAD ELECTRICAL INFRASTRUCTURE TESTS ---')

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

function extractBoxAABBs(obj, out) {
  if (!obj) return
  if (!obj.isMesh && !obj.isInstancedMesh && Array.isArray(obj.children) && obj.children.length > 0) {
    for (let i = 0; i < obj.children.length; i += 1) {
      extractBoxAABBs(obj.children[i], out)
    }
    return
  }
  if (obj.isInstancedMesh && obj.geometry) {
    obj.geometry.computeBoundingBox()
    const baseBox = obj.geometry.boundingBox
    const mat = new THREE.Matrix4()
    const tmpBox = new THREE.Box3()
    for (let i = 0; i < obj.count; i += 1) {
      obj.getMatrixAt(i, mat)
      tmpBox.copy(baseBox).applyMatrix4(mat)
      out.push({
        minX: tmpBox.min.x,
        maxX: tmpBox.max.x,
        minY: tmpBox.min.y,
        maxY: tmpBox.max.y,
        minZ: tmpBox.min.z,
        maxZ: tmpBox.max.z,
      })
    }
    return
  }
  const cachedBounds = obj.geometry?.userData?.boxBounds
  if (Array.isArray(cachedBounds)) {
    for (let i = 0; i < cachedBounds.length; i += 1) {
      const b = cachedBounds[i]
      out.push({
        minX: b.minX,
        maxX: b.maxX,
        minY: b.minY,
        maxY: b.maxY,
        minZ: b.minZ,
        maxZ: b.maxZ,
      })
    }
    return
  }
  const pos = obj.geometry?.attributes?.position
  if (!pos) return
  for (let i = 0; i + 24 <= pos.count; i += 24) {
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (let k = 0; k < 24; k += 1) {
      const vx = pos.getX(i + k)
      const vy = pos.getY(i + k)
      const vz = pos.getZ(i + k)
      if (vx < minX) minX = vx
      if (vx > maxX) maxX = vx
      if (vy < minY) minY = vy
      if (vy > maxY) maxY = vy
      if (vz < minZ) minZ = vz
      if (vz > maxZ) maxZ = vz
    }
    out.push({ minX, maxX, minY, maxY, minZ, maxZ })
  }
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Placement, Clearances & Zero Intersection with Ceiling, Vents & Lights
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Conduit/cable-tray placement, clearances & non-intersection across all 4 difficulties')

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
  getEnvironmentalPropTextureSet()

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 8081 })
    const t0 = performance.now()
    const group = buildMazeMeshes(maze)
    const buildMs = performance.now() - t0
    assert.ok(buildMs < 500, `buildMazeMeshes(${difficulty}) stays < 500ms (${buildMs.toFixed(1)}ms)`)

    // Root contracts & ceiling geometry untouched
    const wallMeshes = getLayerMeshes(group.getObjectByName('maze-walls'))
    const capMeshes = getLayerMeshes(group.getObjectByName('maze-wall-caps'))
    assert.ok(wallMeshes.length >= 1 && wallMeshes.every((m) => m.isInstancedMesh))
    assert.ok(capMeshes.length >= 1 && capMeshes.every((m) => m.isInstancedMesh))
    assert.equal(group.userData.ceilingGroup.userData.soffitY, MAZE_CEILING_CONFIG.soffitY)

    const electricalGroup = group.getObjectByName('maze-ceiling-electrical-group')
    const conduitNode = group.getObjectByName('maze-ceiling-conduits')
    const hardwareNode = group.getObjectByName('maze-ceiling-electrical-hardware')
    const cableNode = group.getObjectByName('maze-ceiling-cables')
    const conduitMeshes = getLayerMeshes(conduitNode)
    const hardwareMeshes = getLayerMeshes(hardwareNode)
    const cableMeshes = getLayerMeshes(cableNode)
    assert.ok(
      electricalGroup && conduitMeshes.length > 0 && hardwareMeshes.length > 0 && cableMeshes.length > 0,
      `All 3 electrical layers exist on ${difficulty}`
    )

    // Zero extra lights; thin soffit-flush electrical conduits/hardware/cables skip shadow casting while receiving shadows
    let childLights = 0
    electricalGroup.traverse((n) => {
      if (n.isLight) childLights += 1
    })
    assert.equal(childLights, 0, 'Electrical details introduce zero real-time lights')
    for (const mesh of [...conduitMeshes, ...hardwareMeshes, ...cableMeshes]) {
      assert.equal(mesh.castShadow, false, `${mesh.name} has castShadow = false`)
      assert.equal(mesh.receiveShadow, true, `${mesh.name} receives shadows`)
    }

    // Reuses pooled galvanized steel maps (zero unpooled texture leaks)
    assert.equal(isSharedResource(conduitMeshes[0].material.map), true)
    assert.equal(isSharedResource(hardwareMeshes[0].material.map), true)
    assert.equal(isSharedResource(cableMeshes[0].material.roughnessMap), true)

    // Check summary counts: conduits, cable trays, junction boxes, connections & aged/damaged states
    const ud = electricalGroup.userData
    assert.ok(ud.conduitRunCount >= 4, `${difficulty} has conduit runs (${ud.conduitRunCount})`)
    assert.ok(ud.cableTrayCount >= 2, `${difficulty} has cable trays (${ud.cableTrayCount})`)
    assert.ok(ud.junctionBoxCount >= 3, `${difficulty} has junction boxes (${ud.junctionBoxCount})`)
    assert.ok(ud.connectedLightCount >= 2, `${difficulty} wires lights to junctions (${ud.connectedLightCount})`)
    assert.ok(ud.connectedVentCount >= 1, `${difficulty} wires vent equipment (${ud.connectedVentCount})`)

    const conditionsSeen = new Set(ud.electricalMetadata.map((m) => m.condition))
    assert.ok(
      conditionsSeen.has('intact') && (conditionsSeen.has('aged') || conditionsSeen.has('damaged')),
      `${difficulty} mixes intact & deteriorated electrical states`
    )
    for (const cond of conditionsSeen) {
      assert.ok(CEILING_ELECTRICAL_CONDITIONS.includes(cond))
    }

    // Strict vertical clearance check on every single vertex of all 3 electrical meshes
    const topLeft = gridToWorld(0, 0, maze)
    const bottomRight = gridToWorld(maze.rows - 1, maze.cols - 1, maze)
    const centerX = (topLeft.x + bottomRight.x) * 0.5
    const centerZ = (topLeft.z + bottomRight.z) * 0.5
    const halfSpanX = (maze.cols * CELL_SIZE - 0.7) * 0.5
    const halfSpanZ = (maze.rows * CELL_SIZE - 0.7) * 0.5

    for (const mesh of [...conduitMeshes, ...hardwareMeshes, ...cableMeshes]) {
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      assert.ok(
        box.min.y >= CEILING_ELECTRICAL_CLEARANCE_MIN_Y && box.min.y > MIN_REQUIRED_CLEARANCE,
        `${mesh.name} on ${difficulty} clears beams/camera/actors (minY=${box.min.y.toFixed(3)}m > ${MIN_REQUIRED_CLEARANCE.toFixed(3)}m)`
      )
      assert.ok(
        box.max.y <= MAZE_CEILING_CONFIG.soffitY + 0.005,
        `${mesh.name} on ${difficulty} stays below ceiling soffit (maxY=${box.max.y.toFixed(3)}m)`
      )

      const pos = mesh.geometry.attributes.position
      for (let i = 0; i < pos.count; i += 1) {
        const vx = pos.getX(i)
        const vy = pos.getY(i)
        const vz = pos.getZ(i)
        assert.ok(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz))
        assert.ok(
          Math.abs(vx - centerX) <= halfSpanX && Math.abs(vz - centerZ) <= halfSpanZ,
          `${mesh.name} stays inside outer concrete spandrel bounds on ${difficulty}`
        )
      }
    }

    // Verify ZERO geometric overlap between electrical hardware/junction boxes & concrete beams/vents/lights
    const obstacleAABBs = []
    extractBoxAABBs(group.getObjectByName('maze-ceiling-beams'), obstacleAABBs)
    extractBoxAABBs(group.getObjectByName('maze-ceiling-ducts'), obstacleAABBs)
    extractBoxAABBs(group.getObjectByName('maze-ceiling-duct-hardware'), obstacleAABBs)
    extractBoxAABBs(group.getObjectByName('maze-ceiling-vent-cavities'), obstacleAABBs)
    extractBoxAABBs(group.getObjectByName('maze-ceiling-light-housings'), obstacleAABBs)
    extractBoxAABBs(group.getObjectByName('maze-ceiling-light-diffusers'), obstacleAABBs)

    const hardwareAABBs = []
    extractBoxAABBs(hardwareNode, hardwareAABBs)
    for (let i = 0; i < hardwareAABBs.length; i += 1) {
      const hb = hardwareAABBs[i]
      for (let j = 0; j < obstacleAABBs.length; j += 1) {
        const ob = obstacleAABBs[j]
        const overlap =
          hb.maxX > ob.minX + 0.002 &&
          hb.minX < ob.maxX - 0.002 &&
          hb.maxY > ob.minY + 0.002 &&
          hb.minY < ob.maxY - 0.002 &&
          hb.maxZ > ob.minZ + 0.002 &&
          hb.minZ < ob.maxZ - 0.002
        assert.equal(
          overlap,
          false,
          `Electrical hardware box #${i} on ${difficulty} must not intersect beam/vent/light AABB #${j}`
        )
      }
    }

    // Verify all vertices on conduits/cables stay outside primary concrete girder bands
    const evenRowZs = []
    for (let r = 2; r <= maze.rows - 3; r += 2) evenRowZs.push(gridToWorld(r, 0, maze).z)
    const evenColXs = []
    for (let c = 2; c <= maze.cols - 3; c += 2) evenColXs.push(gridToWorld(0, c, maze).x)
    const beamHalf = MAZE_CEILING_CONFIG.beamWidth * 0.5
    for (const mesh of [...conduitMeshes, ...cableMeshes]) {
      const pos = mesh.geometry.attributes.position
      for (let i = 0; i < pos.count; i += 1) {
        const vx = pos.getX(i)
        const vz = pos.getZ(i)
        for (const rz of evenRowZs) {
          assert.ok(Math.abs(vz - rz) >= beamHalf, `${mesh.name} clears evenRowZ girder`)
        }
        for (const cx of evenColXs) {
          assert.ok(Math.abs(vx - cx) >= beamHalf, `${mesh.name} clears evenColX girder`)
        }
      }
    }

    disposeMazeGroup(group)
  }

  console.log('✓ All 4 difficulties preserve clearance & non-intersection across beams, vents, and lights')
}

// ---------------------------------------------------------------------------
// 2. Deterministic Placement & Seed Variation
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Deterministic electrical layout parity and seed variation')

  const mazeA = generateMaze({ difficulty: 'large', seed: 4242 })
  const mazeB = generateMaze({ difficulty: 'large', seed: 4242 })
  const mazeC = generateMaze({ difficulty: 'large', seed: 9191 })

  const groupA = buildMazeMeshes(mazeA)
  const groupB = buildMazeMeshes(mazeB)
  const groupC = buildMazeMeshes(mazeC)

  const elA = groupA.getObjectByName('maze-ceiling-electrical-group')
  const elB = groupB.getObjectByName('maze-ceiling-electrical-group')
  const elC = groupC.getObjectByName('maze-ceiling-electrical-group')

  assert.equal(elA.userData.conduitRunCount, elB.userData.conduitRunCount)
  assert.equal(elA.userData.cableTrayCount, elB.userData.cableTrayCount)
  assert.equal(elA.userData.junctionBoxCount, elB.userData.junctionBoxCount)
  assert.equal(elA.userData.damagedCount, elB.userData.damagedCount)
  const conduitMeshesA = getLayerMeshes(elA.userData.conduitMesh)
  const conduitMeshesB = getLayerMeshes(elB.userData.conduitMesh)
  const conduitMeshesC = getLayerMeshes(elC.userData.conduitMesh)
  assert.equal(conduitMeshesA.length, conduitMeshesB.length, 'Identical seed produces same chunk count')

  const totalVertsA = conduitMeshesA.reduce((s, m) => s + m.geometry.attributes.position.count, 0)
  const totalVertsB = conduitMeshesB.reduce((s, m) => s + m.geometry.attributes.position.count, 0)
  assert.equal(
    totalVertsA,
    totalVertsB,
    'Identical seed produces bit-for-bit matching conduit vertex counts'
  )

  for (let c = 0; c < conduitMeshesA.length; c += 1) {
    const posA = conduitMeshesA[c].geometry.attributes.position.array
    const posB = conduitMeshesB[c].geometry.attributes.position.array
    assert.equal(posA.length, posB.length)
    for (let i = 0; i < posA.length; i += 17) {
      assert.equal(posA[i], posB[i], 'Deterministic conduit positions match across identical seeds')
    }
  }

  // Different maze seeds vary electrical detail placement
  const posA0 = conduitMeshesA[0].geometry.attributes.position.array
  const posC0 = conduitMeshesC[0].geometry.attributes.position.array
  const differs =
    posA0.length !== posC0.length ||
    elA.userData.junctionBoxCount !== elC.userData.junctionBoxCount ||
    posA0[0] !== posC0[0]
  assert.ok(differs, 'Different seeds produce varied electrical routing')

  disposeMazeGroup(groupA)
  disposeMazeGroup(groupB)
  disposeMazeGroup(groupC)
  console.log('✓ Deterministic placement and seed variation verified')
}

// ---------------------------------------------------------------------------
// 3. Presets, Reduced Motion, High Contrast, HorrorDirector & Clean Disposal
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Presets, Reduced Motion, High Contrast, HorrorDirector & repeated cleanup')

  const { engine } = createHeadlessEngine({
    reducedMotion: true,
    graphicsConfig: {
      qualityPreset: 'high',
      dynamicLights: true,
      highContrast: false,
    },
  })

  // Repeated maze creation & destruction across difficulties (10 cycles)
  const difficulties = ['small', 'medium', 'large', 'hardcore']
  for (let run = 0; run < 10; run += 1) {
    const diff = difficulties[run % difficulties.length]
    const maze = generateMaze({ difficulty: diff, seed: 3000 + run })
    engine.setMaze(maze)
    engine.stepFrame(0.016)
    const mazeRoot = engine.getMazeGroup()
    assert.ok(mazeRoot.getObjectByName('maze-ceiling-conduits'), `Run ${run} mounts conduits`)
    assert.ok(mazeRoot.getObjectByName('maze-ceiling-electrical-hardware'), `Run ${run} mounts hardware`)
    assert.ok(mazeRoot.getObjectByName('maze-ceiling-cables'), `Run ${run} mounts cables`)
  }
  // Shared pool reuse across 10 same-preset maze resets holds only 1 entry
  assert.equal(getCeilingVentPoolStats().entries, 1)

  // Camera modes (1st person & 3rd person) remain unobstructed
  engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
  engine.stepFrame(0.016)
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
  engine.stepFrame(0.016)

  // Graphics presets retain consistent static structural details
  for (const preset of ['performance', 'balanced', 'high']) {
    engine.updateGraphicsConfig({ qualityPreset: preset })
    engine.stepFrame(0.016)
    const root = engine.getMazeGroup()
    assert.ok(root.getObjectByName('maze-ceiling-conduits'), `Conduits intact on ${preset}`)
    assert.ok(root.getObjectByName('maze-ceiling-cables'), `Cables intact on ${preset}`)
  }

  // High Contrast mode preserves visibility without breaking electrical meshes
  engine.setHighContrast(true)
  engine.stepFrame(0.016)
  assert.ok(engine.getMazeGroup().getObjectByName('maze-ceiling-conduits'))
  engine.setHighContrast(false)

  // HorrorDirector blackout does not crash or corrupt static ceiling electrical assets
  engine.updateHorrorConfig({ enabled: true, intensity: 1, reducedMotion: false })
  engine.horrorDirector.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, { duration: 1.0 })
  engine.stepFrame(0.25)
  engine.stepFrame(1.1)
  assert.ok(engine.getMazeGroup().getObjectByName('maze-ceiling-electrical-group'))

  // Shared pool holds 1 entry per quality preset visited across live switches (performance/balanced/high)
  assert.equal(getCeilingVentPoolStats().entries, 3)

  engine.dispose()
  assert.equal(getMazeSurfacePoolStats().entries, 0)
  assert.equal(getBackdropPoolStats().entries, 0)
  assert.equal(getCeilingVentPoolStats().entries, 0)
  assert.equal(getCeilingLightPoolStats().entries, 0)

  console.log('✓ Presets, Reduced Motion, High Contrast, HorrorDirector & repeated cleanup verified')
}

console.log('=== ALL OVERHEAD ELECTRICAL INFRASTRUCTURE TESTS PASSED! ===')
