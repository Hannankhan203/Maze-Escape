import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  ELEVATOR_SHAFT_CONFIG,
  ELEVATOR_SHAFT_PALETTE,
  computeShaftDepthVisibility,
  resolveElevatorShaftCutouts,
  subtractCutoutRectsFromBoxes,
  syncElevatorShaftsQuality,
  syncExtractionShaftState,
} from './buildElevatorShafts.js'
import { getElevatorPoolStats, resolveElevatorLayout } from './buildElevators.js'
import { MAZE_CEILING_CONFIG } from './buildMazeCeiling.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { CAMERA_MODES, THIRD_PERSON_CAMERA_MODES } from './CameraRig.js'
import { HIGH_CONTRAST_COLORS } from './highContrastOutlines.js'
import { getMazeSurfacePoolStats } from './mazeSurfaceTextures.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools, getActiveSharedPoolOwnerCount } from './sharedResources.js'
import { getBackdropPoolStats } from './undergroundBackdrop.js'

console.log('--- RUNNING PHASE 4 ELEVATOR SHAFT OPENINGS & INTERIORS TESTS ---')

function createMockRenderer() {
  const renderer = {
    domElement: { style: {} },
    capabilities: { getMaxAnisotropy: () => 8 },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: {
      enabled: false,
      type: null,
      needsUpdate: false,
    },
    pixelRatio: 1,
    setPixelRatio(r) {
      this.pixelRatio = r
    },
    setSize() {},
    render() {},
    dispose() {},
    getContext() {
      return null
    },
  }
  return renderer
}

function createHeadlessEngine(options = {}) {
  const canvasHost = {
    appendChild() {},
    removeChild() {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  return new MazeSceneEngine(canvasHost, {
    createRenderer: () => createMockRenderer(),
    isSoftwareGl: false,
    lowPerformance: false,
    enemies: { autoSpawn: false },
    ...options,
  })
}

function isObjectDescendantOf(obj, ancestorName) {
  let cur = obj
  while (cur) {
    if (cur.name === ancestorName) return true
    cur = cur.parent
  }
  return false
}

function createSyntheticBraidedMaze() {
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  return {
    id: 'braided-shaft-test',
    rows: 7,
    cols: 7,
    start: { row: 1, col: 1 },
    exit: { row: 5, col: 5 },
    grid: [
      [W, W, W, W, W, W, W],
      [W, P, P, P, P, P, W],
      [W, P, W, P, W, P, W],
      [W, P, P, P, P, P, W],
      [W, P, W, P, W, P, W],
      [W, P, P, P, P, P, W],
      [W, W, W, W, W, W, W],
    ],
    keycards: [],
    collectibles: { coins: [], powerUps: [] },
  }
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Cutout CSG Helper, Genuine Ceiling Openings & Raycast Sightlines
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Genuine ceiling & backdrop cutouts, intact surroundings & upward raycast sightlines')

  // Verify box subtraction math splits intersecting slab cleanly into 4 non-overlapping strips
  const baseSlab = [{ cx: 0, cy: 4.0, cz: 0, sx: 20, sy: 0.8, sz: 20, cullFaces: 0 }]
  const cut = [{ cx: 0, cz: 0, minX: -1.54, maxX: 1.54, minZ: -1.54, maxZ: 1.54 }]
  const splitPieces = subtractCutoutRectsFromBoxes(baseSlab, cut)
  assert.equal(splitPieces.length, 4, 'Subtracting centered cutout produces 4 surrounding perimeter strips')
  for (const piece of splitPieces) {
    const px0 = piece.cx - piece.sx * 0.5
    const px1 = piece.cx + piece.sx * 0.5
    const pz0 = piece.cz - piece.sz * 0.5
    const pz1 = piece.cz + piece.sz * 0.5
    const overlapX = Math.min(px1, cut[0].maxX) - Math.max(px0, cut[0].minX)
    const overlapZ = Math.min(pz1, cut[0].maxZ) - Math.max(pz0, cut[0].minZ)
    assert.ok(overlapX <= 1e-4 || overlapZ <= 1e-4, 'Split ceiling strip has zero overlap with shaft cutout')
  }

  const raycaster = new THREE.Raycaster()
  const upDir = new THREE.Vector3(0, 1, 0)
  const testConfigs = [
    { difficulty: 'small', seed: 101 },
    { difficulty: 'medium', seed: 202 },
    { difficulty: 'large', seed: 303 },
    { difficulty: 'hardcore', seed: 404 },
    { customMaze: createSyntheticBraidedMaze(), label: 'braided' },
  ]

  for (const entry of testConfigs) {
    const label = entry.label || `${entry.difficulty}-${entry.seed}`
    const maze = entry.customMaze || generateMaze({ difficulty: entry.difficulty, seed: entry.seed })
    const engine = createHeadlessEngine({ graphics: { qualityPreset: 'high' } })
    const t0 = performance.now()
    engine.setMaze(maze)
    const setupMs = performance.now() - t0
    assert.ok(
      entry.difficulty !== 'small' || setupMs < 2500,
      `${label}: cold engine.setMaze stays responsive (${setupMs.toFixed(1)}ms)`
    )
    if (entry.difficulty === 'small') {
      const tw0 = performance.now()
      const warmRoot = buildMazeMeshes(maze, { qualityPreset: 'high' })
      const warmMs = performance.now() - tw0
      disposeMazeGroup(warmRoot)
      assert.ok(warmMs < 500, `${label}: warm buildMazeMeshes stays under 500ms (${warmMs.toFixed(1)}ms)`)
    }

    const mazeGroup = engine.getMazeGroup()
    const backdropGroup = engine.getEnvironment().details.backdropGroup
    mazeGroup.updateMatrixWorld(true)
    backdropGroup.updateMatrixWorld(true)

    const rayTargets = [mazeGroup, backdropGroup]
    const cutouts = resolveElevatorShaftCutouts(maze)
    assert.equal(cutouts.length, 2, `${label}: resolved both start and exit cutouts`)

    const blockedOverheadAncestors = [
      'maze-ceiling-deck',
      'maze-ceiling-beams',
      'maze-ceiling-beam-details',
      'maze-ceiling-imperfections',
      'maze-ceiling-vents-group',
      'maze-ceiling-lights-group',
      'maze-ceiling-electrical-group',
      'maze-env-ceiling-vault',
      'maze-env-gantries',
      'maze-env-vents',
      'maze-env-cables',
    ]

    for (const c of cutouts) {
      const expectedTopY =
        c.kind === 'start' ? ELEVATOR_SHAFT_CONFIG.startShaftTopY : ELEVATOR_SHAFT_CONFIG.exitShaftTopY
      const crownName = c.kind === 'start' ? 'start-shaft-dark-crown' : 'exit-shaft-dark-crown'

      // Check vertical ray grid inside center sightline ([-0.9 .. 0.9], staying away from rim trim & cab grate)
      const offsets = c.kind === 'start'
        ? [[0, 0], [0.45, -0.45], [0.45, 0.35], [-0.25, -0.45]]
        : [[0, 0], [-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]

      for (const [ox, oz] of offsets) {
        const origin = new THREE.Vector3(c.cx + ox, 1.72, c.cz + oz)
        raycaster.set(origin, upDir)
        const hits = raycaster.intersectObjects(rayTargets, true)
        assert.ok(hits.length > 0, `${label} ${c.kind} (${ox},${oz}) upward ray hits shaft interior crown`)

        for (const hit of hits) {
          for (const forbidden of blockedOverheadAncestors) {
            assert.equal(
              isObjectDescendantOf(hit.object, forbidden),
              false,
              `${label} ${c.kind} (${ox},${oz}) upward sightline hit blocked geometry ${forbidden} (${hit.object.name}) at y=${hit.point.y.toFixed(2)}`
            )
          }
          // Must not hit low flat elevator cab ceiling plate at center
          assert.notEqual(
            hit.object.name,
            'start-elevator-ceiling-grate',
            `${label} start center upward sightline clears offset broken grate`
          )
          assert.ok(
            !hit.object.name.startsWith('extraction-elevator-ceiling-deck'),
            `${label} exit center upward sightline passes cleanly through cab skylight aperture`
          )
        }

        const crownHit = hits.find((h) => h.object.name === crownName)
        assert.ok(
          crownHit && crownHit.point.y >= expectedTopY - 0.5,
          `${label} ${c.kind} center upward ray reaches upper dark crown at y=${crownHit?.point?.y?.toFixed(2)}m`
        )
      }

      // Check oblique rays hit genuine 3D shaft structures between y=3.5m and y=21m
      const obliqueDirs = [
        new THREE.Vector3(0.32, 1, 0).normalize(),
        new THREE.Vector3(-0.32, 1, 0).normalize(),
        new THREE.Vector3(0, 1, 0.3).normalize(),
        new THREE.Vector3(0, 1, -0.3).normalize(),
      ]
      let shaftStructHits = 0
      for (const dir of obliqueDirs) {
        raycaster.set(new THREE.Vector3(c.cx, 1.72, c.cz), dir)
        const hits = raycaster.intersectObjects(rayTargets, true)
        for (const h of hits) {
          if (
            isObjectDescendantOf(
              h.object,
              c.kind === 'start' ? 'maze-start-elevator-shaft' : 'maze-exit-elevator-shaft'
            ) &&
            h.point.y > 3.5 &&
            h.point.y < expectedTopY - 0.6
          ) {
            shaftStructHits += 1
          }
        }
      }
      assert.ok(
        shaftStructHits >= 4,
        `${label} ${c.kind} oblique upward view intersects real 3D shaft structures (${shaftStructHits} hits)`
      )

      // Check an adjacent walkable corridor cell outside the cutout still has intact solid ceiling deck at y=3.60m
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      let checkedNeighbor = false
      for (const [dr, dc] of dirs) {
        const nr = c.row + dr
        const nc = c.col + dc
        if (maze.grid[nr]?.[nc] !== CELL_TYPES.PATH) continue
        const nWorld = gridToWorld(nr, nc, maze)
        raycaster.set(new THREE.Vector3(nWorld.x, 1.72, nWorld.z), upDir)
        const hits = raycaster.intersectObjects([mazeGroup.getObjectByName('maze-ceiling-deck')], true)
        const deckHit = hits.find((h) => h.point.y >= MAZE_CEILING_CONFIG.soffitY - 0.05)
        assert.ok(
          deckHit && deckHit.point.y <= MAZE_CEILING_CONFIG.soffitY + 0.05,
          `${label} neighbor corridor (${nr},${nc}) keeps intact ceiling slab at soffit y=${deckHit?.point?.y?.toFixed(2)}`
        )
        checkedNeighbor = true
        break
      }
      assert.ok(checkedNeighbor, `${label} ${c.kind} checked at least one adjacent corridor ceiling`)
    }

    // Check zero ceiling imperfections sit inside cutouts
    const impGroup = mazeGroup.getObjectByName('maze-ceiling-imperfections')
    if (impGroup) {
      impGroup.traverse((node) => {
        if (!node.isMesh || !node.userData?.decalCount) return
        const posAttr = node.geometry.attributes.position
        for (let i = 0; i < node.userData.decalCount; i += 1) {
          const cx = (posAttr.getX(i * 4) + posAttr.getX(i * 4 + 2)) * 0.5
          const cz = (posAttr.getZ(i * 4) + posAttr.getZ(i * 4 + 2)) * 0.5
          for (const cut of cutouts) {
            const inside =
              cx >= cut.minX && cx <= cut.maxX && cz >= cut.minZ && cz <= cut.maxZ
            assert.equal(inside, false, `${label} ceiling decal avoids ${cut.kind} cutout`)
          }
        }
      })
    }

    engine.dispose()
  }

  disposeAllSharedPools()
  console.log('✓ Genuine ceiling & backdrop openings + intact adjacent ceilings verified across all difficulties & braided layout')
}

// ---------------------------------------------------------------------------
// 2. Starting & Extraction Shaft Anatomy, Alignment & Cab Sightlines
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Starting damaged shaft & extraction industrial shaft anatomy and world alignment')

  const maze = generateMaze({ difficulty: 'medium', seed: 9191 })
  const root = buildMazeMeshes(maze, { qualityPreset: 'high' })
  const shaftsGroup = root.getObjectByName('maze-elevator-shafts-group')
  assert.ok(shaftsGroup && shaftsGroup.userData.isElevatorShaftsGroup, 'Elevator shafts root attached to mazeGroup')

  const startShaft = shaftsGroup.userData.startShaft
  const exitShaft = shaftsGroup.userData.exitShaft
  assert.ok(startShaft && startShaft.userData.isStartElevatorShaft, 'Start shaft built')
  assert.ok(exitShaft && exitShaft.userData.isExitElevatorShaft, 'Exit shaft built')

  // Alignment with elevator platforms
  const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)
  const exitWorld = gridToWorld(maze.exit.row, maze.exit.col, maze)
  const startLayout = resolveElevatorLayout(maze, maze.start)
  const exitLayout = resolveElevatorLayout(maze, maze.exit)

  assert.ok(
    Math.abs(startShaft.position.x - startWorld.x) < 1e-5 &&
      Math.abs(startShaft.position.z - startWorld.z) < 1e-5 &&
      Math.abs(startShaft.rotation.y - startLayout.yaw) < 1e-5,
    'Start shaft aligns strictly with start elevator world XZ and yaw'
  )
  assert.ok(
    Math.abs(exitShaft.position.x - exitWorld.x) < 1e-5 &&
      Math.abs(exitShaft.position.z - exitWorld.z) < 1e-5 &&
      Math.abs(exitShaft.rotation.y - exitLayout.yaw) < 1e-5,
    'Exit shaft aligns strictly with extraction elevator world XZ and yaw'
  )

  // Start shaft required damaged components
  for (const name of [
    'start-shaft-concrete-walls',
    'start-shaft-rusted-steel',
    'start-shaft-damaged-mechanism',
    'start-shaft-exposed-rebar',
    'start-shaft-broken-cables',
    'start-shaft-dark-crown',
  ]) {
    const obj = startShaft.getObjectByName(name)
    assert.ok(obj?.isMesh, `Start shaft includes ${name}`)
  }
  assert.ok(startShaft.userData.railCount >= 4, 'Start shaft includes vertical guide + counterweight rails')
  assert.ok(startShaft.userData.beamCount >= 5, 'Start shaft includes multi-tier rusted structural beams')
  assert.ok(startShaft.userData.brokenCableCount >= 6, 'Start shaft includes staggered hanging broken cables')
  assert.ok(startShaft.userData.rebarCount >= 12, 'Start shaft includes exposed perimeter rebar')

  // Start shaft vertical bounds: above corridor headroom (except rim/broken rebar stays >= 3.35m, rails >= 2.95m)
  const startSteelBounds = new THREE.Box3().setFromObject(
    startShaft.getObjectByName('start-shaft-rusted-steel')
  )
  const startCableBounds = new THREE.Box3().setFromObject(
    startShaft.getObjectByName('start-shaft-broken-cables')
  )
  assert.ok(startSteelBounds.min.y >= 2.94, `Start shaft steel clears walking corridor height (minY=${startSteelBounds.min.y.toFixed(2)}m)`)
  assert.ok(startSteelBounds.max.y >= 20.5, `Start shaft steel rises >20m up shaft (maxY=${startSteelBounds.max.y.toFixed(2)}m)`)
  assert.ok(
    startCableBounds.min.y <= 4.5 && startCableBounds.max.y >= 17.0,
    `Start broken cables span staggered low-to-high shaft heights (${startCableBounds.min.y.toFixed(2)}..${startCableBounds.max.y.toFixed(2)}m)`
  )

  // Exit shaft required industrial components
  for (const name of [
    'exit-shaft-concrete-walls',
    'exit-shaft-structural-steel',
    'exit-shaft-collar-and-beams',
    'exit-shaft-electrical-conduits',
    'exit-shaft-hoist-cables',
    'exit-shaft-counterweight',
    'exit-shaft-status-strips',
    'exit-shaft-dark-crown',
  ]) {
    const obj = exitShaft.getObjectByName(name)
    assert.ok(obj?.isMesh, `Extraction shaft includes ${name}`)
  }
  assert.ok(exitShaft.userData.railCount >= 4, 'Extraction shaft includes vertical guide + counterweight rails')
  assert.ok(exitShaft.userData.beamCount >= 6, 'Extraction shaft includes multi-tier industrial ring beams')
  assert.ok(exitShaft.userData.cableCount >= 8, 'Extraction shaft includes tensioned hoist + counterweight ropes')

  const exitSteelBounds = new THREE.Box3().setFromObject(
    exitShaft.getObjectByName('exit-shaft-structural-steel')
  )
  assert.ok(exitSteelBounds.min.y >= 2.9, `Extraction shaft steel clears portal height (minY=${exitSteelBounds.min.y.toFixed(2)}m)`)
  assert.ok(exitSteelBounds.max.y >= 23.0, `Extraction shaft steel rises >23m up shaft (maxY=${exitSteelBounds.max.y.toFixed(2)}m)`)

  // Verify open skylight aperture in extraction cab deck
  const cabDeck = root.getObjectByName('extraction-elevator-ceiling-deck')
  assert.ok(cabDeck?.isGroup && cabDeck.children.length === 4, 'Extraction cab ceiling is an open 4-piece collar aperture')

  disposeMazeGroup(root)
  disposeAllSharedPools()
  console.log('✓ Start damaged shaft & extraction industrial shaft anatomy and alignment verified')
}

// ---------------------------------------------------------------------------
// 3. Depth-Based Darkness Curve, GLSL Compilation, Relative Contrast & Sync
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Depth darkness curve, GLSL shader hooks, relative darkness & extraction sync')

  // Monotonic falloff curve reaching deep darkness at shaft top
  const vLow = computeShaftDepthVisibility(4.15, 4.15, 22.2, 0.008)
  const vMid = computeShaftDepthVisibility(12.0, 4.15, 22.2, 0.008)
  const vHigh = computeShaftDepthVisibility(18.5, 4.15, 22.2, 0.008)
  const vTop = computeShaftDepthVisibility(22.2, 4.15, 22.2, 0.008)
  assert.equal(vLow, 1, 'Lower shaft collar retains full visibility')
  assert.ok(vLow > vMid && vMid > vHigh && vHigh > vTop, 'Depth visibility strictly monotonically decreases upward')
  assert.ok(vTop < 0.02, `Uppermost shaft fades into deep darkness (vis=${vTop.toFixed(4)})`)

  // Start shaft palette & shader configuration strictly darker than extraction shaft
  const startConcreteColor = new THREE.Color(ELEVATOR_SHAFT_PALETTE.startConcrete)
  const exitConcreteColor = new THREE.Color(ELEVATOR_SHAFT_PALETTE.exitConcrete)
  assert.ok(
    startConcreteColor.getHSL({}).l < exitConcreteColor.getHSL({}).l,
    'Start shaft concrete base tone is darker than extraction shaft concrete'
  )

  const maze = generateMaze({ difficulty: 'medium', seed: 5511 })
  const root = buildMazeMeshes(maze, { qualityPreset: 'high' })
  const shaftsGroup = root.getObjectByName('maze-elevator-shafts-group')
  const startShaft = shaftsGroup.userData.startShaft
  const exitShaft = shaftsGroup.userData.exitShaft

  const startMat = startShaft.userData.materials[0]
  const exitMat = exitShaft.userData.materials[0]
  assert.ok(
    startMat.userData.shaftDepthUniforms.uShaftBaseBrightness.value <
      exitMat.userData.shaftDepthUniforms.uShaftBaseBrightness.value,
    'Start shaft base brightness uniform is dimmer than extraction shaft'
  )
  assert.ok(
    startMat.userData.shaftDepthUniforms.uShaftFadeEndY.value <
      exitMat.userData.shaftDepthUniforms.uShaftFadeEndY.value,
    'Start shaft fades to blackout lower/sooner than extraction shaft'
  )
  assert.equal(
    'uShaftLowerGlowStrength' in startMat.userData.shaftDepthUniforms,
    false,
    'Start shaft has no artificial lower glow uniform'
  )
  assert.equal(
    'uShaftLowerGlowStrength' in exitMat.userData.shaftDepthUniforms,
    false,
    'Extraction shaft has no artificial lower glow uniform'
  )
  assert.equal(
    'uShaftLowerGlowColor' in exitMat.userData.shaftDepthUniforms,
    false,
    'Extraction shaft has no artificial lower glow color uniform'
  )

  // Verify shader hooks inject cleanly into Three.js MeshStandardMaterial
  for (const [label, mat] of [
    ['startMat', startMat],
    ['exitMat', exitMat],
  ]) {
    const mockShader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }
    mat.onBeforeCompile(mockShader)
    for (const uName of [
      'uShaftFadeStartY',
      'uShaftFadeEndY',
      'uShaftMinVis',
      'uShaftDarkTint',
      'uShaftBaseBrightness',
    ]) {
      assert.ok(mockShader.uniforms[uName] !== undefined, `${label} binds ${uName}`)
    }
    assert.equal(mockShader.uniforms.uShaftLowerGlowColor, undefined, `${label} has no artificial glow color uniform`)
    assert.equal(mockShader.uniforms.uShaftLowerGlowStrength, undefined, `${label} has no artificial glow strength uniform`)
    assert.equal(mockShader.fragmentShader.includes('uShaftLowerGlow'), false, `${label} shader has no artificial lower glow math`)
    assert.ok(mockShader.vertexShader.includes('vShaftWorldY'), `${label} passes world Y varying`)
    assert.ok(mockShader.fragmentShader.includes('shaftVis'), `${label} computes shaftVis falloff`)
    assert.ok(mockShader.fragmentShader.includes('shaftUpperSuppress'), `${label} suppresses exponential fog lift near top`)
    assert.equal(mat.customProgramCacheKey(), 'elevator-shaft-depth-v2', `${label} caches custom depth shader`)
  }

  // Verify syncExtractionShaftState across locked -> unlocked -> doors_closing -> departing + reducedMotion
  syncExtractionShaftState(shaftsGroup, { isLocked: true, stage: 'idle' })
  assert.equal(exitShaft.userData.beaconMat.emissive.getHex(), 0xef4444, 'Locked shaft strip glows red')

  syncExtractionShaftState(shaftsGroup, { isLocked: false, stage: 'idle' })
  assert.equal(exitShaft.userData.beaconMat.emissive.getHex(), 0x10b981, 'Unlocked shaft strip switches to emerald')

  syncExtractionShaftState(shaftsGroup, {
    isLocked: false,
    stage: 'doors_closing',
    departureProgress: 0,
  })
  assert.equal(exitShaft.userData.beaconMat.emissive.getHex(), 0xf59e0b, 'Doors-closing stage pulses amber')

  const cwBaseY = exitShaft.userData.counterweightBaseY
  syncExtractionShaftState(shaftsGroup, {
    isLocked: false,
    stage: 'departing',
    departureProgress: 0.9,
    reducedMotion: false,
  })
  assert.equal(exitShaft.userData.beaconMat.emissive.getHex(), 0x10b981, 'Late departure switches back to emerald')
  assert.ok(
    exitShaft.userData.counterweightMesh.position.y < cwBaseY - 0.8,
    'Counterweight lowers during extraction departure'
  )

  syncExtractionShaftState(shaftsGroup, {
    isLocked: false,
    stage: 'departing',
    departureProgress: 0.9,
    reducedMotion: true,
  })
  assert.equal(
    exitShaft.userData.counterweightMesh.position.y,
    cwBaseY,
    'Reduced motion keeps counterweight static'
  )

  disposeMazeGroup(root)
  disposeAllSharedPools()
  console.log('✓ Depth falloff curve, GLSL compilation, start-vs-exit darkness & extraction sync verified')
}

// ---------------------------------------------------------------------------
// 4. Upward 1P/3P Camera Pitch, High Contrast, Presets, Sequences & Disposal
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Upward camera angles, High Contrast outlines, quality presets & resource cleanup')

  const maze = generateMaze({ difficulty: 'medium', seed: 31415 })
  const { engine } = { engine: createHeadlessEngine({ cameraMode: CAMERA_MODES.FIRST_PERSON }) }
  engine.setMaze(maze)

  // Spawn inside start elevator and pitch upward steeply toward shaft
  engine.setLookDirection(0, Math.PI / 2.2)
  engine.cameraRig.snap()
  engine.stepFrame(0.016, { render: false })
  const cam1p = engine.camera
  const lookDir1p = new THREE.Vector3(0, 0, -1).applyQuaternion(cam1p.quaternion)
  assert.ok(lookDir1p.y > 0.9, `1P camera pitches steeply upward into start shaft (dirY=${lookDir1p.y.toFixed(3)})`)

  // Switch to 3P Free Look inside extraction elevator and pitch upward
  const exitWorld = gridToWorld(maze.exit.row, maze.exit.col, maze)
  engine.setPlayerWorldPosition(exitWorld.x, 0.06, exitWorld.z, { immediate: true })
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK, { immediate: true })
  engine.setLookDirection(0, Math.PI / 2.2)
  engine.cameraRig.snap()
  engine.stepFrame(0.016, { render: false })
  const cam3p = engine.camera
  const lookDir3p = new THREE.Vector3(0, 0, -1).applyQuaternion(cam3p.quaternion)
  assert.ok(lookDir3p.y > 0.75, `3P camera looks steeply upward inside extraction shaft (dirY=${lookDir3p.y.toFixed(3)})`)

  // Verify High Contrast adds collar outlines and respects exit lock color without obstructing center view
  const mazeGroup = engine.getMazeGroup()
  const shaftsGroup = mazeGroup.userData.elevatorShaftsGroup
  engine.setExitLocked(true, { animate: false })
  engine.setHighContrast(true)

  const startOutline = shaftsGroup.getObjectByName('start-shaft-collar-outline')
  const exitOutline = shaftsGroup.getObjectByName('exit-shaft-collar-outline')
  assert.ok(startOutline?.visible && startOutline.isLineSegments, 'Start shaft collar wireframe outline enabled in High Contrast')
  assert.ok(exitOutline?.visible && exitOutline.isLineSegments, 'Exit shaft collar wireframe outline enabled in High Contrast')
  assert.equal(exitOutline.material.color.getHex(), HIGH_CONTRAST_COLORS.exitLocked, 'Locked exit shaft outline matches locked color')

  engine.setExitLocked(false, { animate: false })
  assert.equal(exitOutline.material.color.getHex(), HIGH_CONTRAST_COLORS.exitUnlocked, 'Unlocked exit shaft outline updates to unlocked color')

  engine.setHighContrast(false)
  assert.equal(startOutline.visible, false)
  assert.equal(exitOutline.visible, false)

  // Quality presets switch textures cleanly without losing shafts
  for (const preset of ['performance', 'balanced', 'high']) {
    engine.updateGraphicsConfig({ qualityPreset: preset })
    assert.equal(shaftsGroup.userData.qualityPreset, preset, `Quality preset synced to ${preset}`)
    assert.equal(
      syncElevatorShaftsQuality(shaftsGroup, preset),
      true,
      `syncElevatorShaftsQuality succeeds for ${preset}`
    )
  }

  // Verify Phase 2 spawn sequence & Phase 3 extraction sequence still run end-to-end cleanly
  const startedSpawn = engine.restartSpawnSequence({ skipAnimation: false })
  assert.equal(startedSpawn, true, 'Phase 2 spawn sequence runs smoothly inside start shaft')
  for (let i = 0; i < 120; i += 1) {
    engine.stepFrame(0.05, { render: false })
    if (!engine.isSpawnSequenceActive()) break
  }
  assert.equal(engine.isSpawnSequenceActive(), false, 'Spawn sequence completes normally')

  engine.setPlayerWorldPosition(exitWorld.x, 0.06, exitWorld.z, { immediate: true })
  const exitShaftObj = shaftsGroup.userData.exitShaft
  const cwBase = exitShaftObj.userData.counterweightBaseY
  const startedExtraction = engine.startExtractionSequence({ immediate: false })
  assert.equal(startedExtraction, true, 'Phase 3 extraction sequence starts smoothly inside extraction shaft')
  let sawCounterweightMove = false
  let reachedCompleted = false
  for (let i = 0; i < 200; i += 1) {
    engine.stepFrame(0.05, { render: false })
    if (exitShaftObj.userData.counterweightMesh.position.y < cwBase - 0.1) {
      sawCounterweightMove = true
    }
    if (!engine.isExtractionSequenceActive()) {
      reachedCompleted = true
      break
    }
  }
  assert.equal(sawCounterweightMove, true, 'Exit shaft counterweight visibly descends during extraction departure')
  assert.equal(reachedCompleted, true, 'Extraction sequence completes normally with active shaft sync')

  engine.dispose()
  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Zero active shared pool owners remain after engine.dispose()')
  assert.equal(getMazeSurfacePoolStats().entries, 0, 'Surface pool cleaned on disposal')
  assert.equal(getBackdropPoolStats().entries, 0, 'Backdrop pool cleaned on disposal')
  assert.equal(getElevatorPoolStats().textures, 0, 'Elevator pool cleaned on disposal')

  console.log('✓ Upward 1P/3P cameras, High Contrast, quality presets, Phase 2/3 sequences & cleanup verified')
}

// ---------------------------------------------------------------------------
// 5. All Four Cardinal Elevator Orientations (N/S/E/W) & Braided Cutoff Alignment
// ---------------------------------------------------------------------------
{
  console.log('Test 5: All four cardinal orientations (N/S/E/W) & cutout alignment')

  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  const raycaster = new THREE.Raycaster()
  const upDir = new THREE.Vector3(0, 1, 0)

  // Construct minimal 5x5 grids isolating a single open neighbor for N, S, E, W
  const orientationCases = [
    { name: 'South (+Z)', dr: 1, dc: 0, expectedYaw: Math.PI },
    { name: 'North (-Z)', dr: -1, dc: 0, expectedYaw: 0 },
    { name: 'East (+X)', dr: 0, dc: 1, expectedYaw: -Math.PI / 2 },
    { name: 'West (-X)', dr: 0, dc: -1, expectedYaw: Math.PI / 2 },
  ]

  for (const orient of orientationCases) {
    const startGrid = [
      [W, W, W, W, W, W, W],
      [W, W, W, W, W, W, W],
      [W, W, P, W, W, W, W],
      [W, W, W, W, P, W, W],
      [W, W, W, W, W, W, W],
      [W, W, W, W, W, W, W],
      [W, W, W, W, W, W, W],
    ]
    startGrid[2 + orient.dr][2 + orient.dc] = P
    startGrid[3 + orient.dr][4 + orient.dc] = P

    const maze = {
      id: `orient-${orient.name}`,
      rows: 7,
      cols: 7,
      start: { row: 2, col: 2 },
      exit: { row: 3, col: 4 },
      grid: startGrid,
      keycards: [],
      collectibles: { coins: [], powerUps: [] },
    }

    const root = buildMazeMeshes(maze, { qualityPreset: 'balanced' })
    root.updateMatrixWorld(true)
    const shaftsGroup = root.getObjectByName('maze-elevator-shafts-group')
    const startShaft = shaftsGroup.userData.startShaft
    const exitShaft = shaftsGroup.userData.exitShaft

    assert.ok(
      Math.abs(startShaft.rotation.y - orient.expectedYaw) < 1e-5,
      `${orient.name}: start shaft yaw matches expected (${startShaft.rotation.y} vs ${orient.expectedYaw})`
    )
    assert.ok(
      Math.abs(exitShaft.rotation.y - orient.expectedYaw) < 1e-5,
      `${orient.name}: exit shaft yaw matches expected (${exitShaft.rotation.y} vs ${orient.expectedYaw})`
    )

    for (const [kind, cell, crownName, minCrownY] of [
      ['start', maze.start, 'start-shaft-dark-crown', ELEVATOR_SHAFT_CONFIG.startShaftTopY - 0.5],
      ['exit', maze.exit, 'exit-shaft-dark-crown', ELEVATOR_SHAFT_CONFIG.exitShaftTopY - 0.5],
    ]) {
      const world = gridToWorld(cell.row, cell.col, maze)
      raycaster.set(new THREE.Vector3(world.x, 1.72, world.z), upDir)
      const hits = raycaster.intersectObjects([root], true)
      const deckBlock = hits.find((h) => isObjectDescendantOf(h.object, 'maze-ceiling-deck'))
      assert.equal(deckBlock, undefined, `${orient.name} ${kind}: zero ceiling deck blocking upward sightline`)
      const crownHit = hits.find((h) => h.object.name === crownName)
      assert.ok(
        crownHit && crownHit.point.y >= minCrownY,
        `${orient.name} ${kind}: upward sightline reaches upper dark crown`
      )
    }

    disposeMazeGroup(root)
  }

  disposeAllSharedPools()
  console.log('✓ All four cardinal orientations (N/S/E/W) & shaft cutout alignments verified')
}

console.log('=== ALL PHASE 4 ELEVATOR SHAFT TESTS PASSED! ===')
