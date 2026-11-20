import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { placeEnvironmentalProps, PROP_TYPES } from '../generation/environmentalPropPlacement.js'
import { COLLECTIBLE_PALETTE } from './buildCollectibles.js'
import {
  PROP_MATERIAL_PALETTE,
  buildEnvironmentalProps,
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
      assert.equal(node.castShadow, true, 'Prop mesh preserves castShadow = true')
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

console.log('=== ALL ENVIRONMENTAL PROP MATERIAL & LIFECYCLE TESTS PASSED! ===')
