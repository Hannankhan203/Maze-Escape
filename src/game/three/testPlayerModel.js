import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  DEFAULT_PLAYER_MODEL_CONFIG,
  PLAYER_PALETTE,
  buildPlayer,
  disposePlayer,
  positionPlayerAtGrid,
  positionPlayerAtWorld,
  syncPlayerQuality,
} from './buildPlayer.js'
import { PlayerAnimator } from './PlayerAnimator.js'
import {
  disposePlayerTexturePools,
  getPlayerTexturePoolStats,
  getPlayerTexturePresetRefCount,
  getPlayerTextureSet,
} from './playerTextures.js'
import {
  disposeAllSharedPools,
  isSharedResource,
} from './sharedResources.js'

console.log('--- RUNNING PROCEDURAL PLAYER MODEL TESTS (PHASE 2) ---')

function computeMeshWorldBounds(mesh, root) {
  root.updateMatrixWorld(true)
  mesh.geometry.computeBoundingBox()
  return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
}

function getTriangleCount(geometry) {
  if (geometry.index) {
    return geometry.index.count / 3
  }
  return geometry.attributes.position.count / 3
}

// ---------------------------------------------------------------------------
// 1. Headless Synchronous Build, Rig Hierarchy & Legacy Aliases
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Headless synchronous buildPlayer(), 16-pivot rig & legacy aliases')
  disposeAllSharedPools()

  const player = buildPlayer({ visible: true })
  assert.ok(player instanceof THREE.Group, 'buildPlayer returns THREE.Group synchronously')
  assert.equal(player.name, 'maze-player-root')
  assert.equal(player.visible, true)
  assert.equal(player.userData.isPlayerModel, true)
  assert.equal(player.userData.height, DEFAULT_PLAYER_MODEL_CONFIG.height)
  assert.equal(player.userData.eyeHeight, DEFAULT_PLAYER_MODEL_CONFIG.eyeHeight)
  assert.equal(player.userData.radius, DEFAULT_PLAYER_MODEL_CONFIG.radius)

  const rig = player.userData.rig
  assert.ok(rig, 'userData.rig exists')

  const requiredPivots = [
    'pelvisPivot',
    'spinePivot',
    'neckPivot',
    'headPivot',
    'leftShoulderPivot',
    'leftElbowPivot',
    'leftWristPivot',
    'rightShoulderPivot',
    'rightElbowPivot',
    'rightWristPivot',
    'leftHipPivot',
    'leftKneePivot',
    'leftAnklePivot',
    'rightHipPivot',
    'rightKneePivot',
    'rightAnklePivot',
  ]
  for (const pivotKey of requiredPivots) {
    assert.ok(
      rig[pivotKey] instanceof THREE.Group,
      `rig.${pivotKey} is a THREE.Group pivot`
    )
  }

  // Verify anatomical parent-child hierarchy
  assert.equal(rig.pelvisPivot.parent, player)
  assert.equal(rig.spinePivot.parent, rig.pelvisPivot)
  assert.equal(rig.neckPivot.parent, rig.spinePivot)
  assert.equal(rig.headPivot.parent, rig.neckPivot)

  assert.equal(rig.leftShoulderPivot.parent, rig.spinePivot)
  assert.equal(rig.leftElbowPivot.parent, rig.leftShoulderPivot)
  assert.equal(rig.leftWristPivot.parent, rig.leftElbowPivot)

  assert.equal(rig.rightShoulderPivot.parent, rig.spinePivot)
  assert.equal(rig.rightElbowPivot.parent, rig.rightShoulderPivot)
  assert.equal(rig.rightWristPivot.parent, rig.rightElbowPivot)

  assert.equal(rig.leftHipPivot.parent, rig.pelvisPivot)
  assert.equal(rig.leftKneePivot.parent, rig.leftHipPivot)
  assert.equal(rig.leftAnklePivot.parent, rig.leftKneePivot)

  assert.equal(rig.rightHipPivot.parent, rig.pelvisPivot)
  assert.equal(rig.rightKneePivot.parent, rig.rightHipPivot)
  assert.equal(rig.rightAnklePivot.parent, rig.rightKneePivot)

  // Verify legacy rig aliases required by existing PlayerAnimator
  assert.equal(rig.upperBodyPivot, rig.spinePivot, 'upperBodyPivot aliases spinePivot')
  assert.equal(rig.leftLegPivot, rig.leftHipPivot, 'leftLegPivot aliases leftHipPivot')
  assert.equal(rig.rightLegPivot, rig.rightHipPivot, 'rightLegPivot aliases rightHipPivot')
  assert.equal(rig.leftArmPivot, rig.leftShoulderPivot, 'leftArmPivot aliases leftShoulderPivot')
  assert.equal(rig.rightArmPivot, rig.rightShoulderPivot, 'rightArmPivot aliases rightShoulderPivot')
  assert.ok(rig.restPose && Number.isFinite(rig.restPose.upperBodyY))
  assert.ok(Number.isFinite(rig.restPose.leftLegY))
  assert.ok(Number.isFinite(rig.restPose.rightLegY))

  // Verify required anatomical/clothing named meshes exist
  const expectedMeshes = [
    'maze-player-pelvis-trousers',
    'maze-player-belt',
    'maze-player-belt-buckle',
    'maze-player-torso-jacket',
    'maze-player-backpack',
    'maze-player-torso-hardware',
    'maze-player-neck',
    'maze-player-head-skin',
    'maze-player-lips',
    'maze-player-hair',
    'maze-player-eyes-sclera',
    'maze-player-eyes-iris',
    'maze-player-upper-arm-left',
    'maze-player-forearm-left',
    'maze-player-hand-left',
    'maze-player-upper-arm-right',
    'maze-player-forearm-right',
    'maze-player-hand-right',
    'maze-player-thigh-left',
    'maze-player-shin-left',
    'maze-player-boot-left',
    'maze-player-boot-hardware-left',
    'maze-player-thigh-right',
    'maze-player-shin-right',
    'maze-player-boot-right',
    'maze-player-boot-hardware-right',
  ]
  for (const name of expectedMeshes) {
    const obj = player.getObjectByName(name)
    assert.ok(obj && obj.isMesh, `Expected anatomical mesh ${name} exists`)
    assert.equal(obj.castShadow, true, `${name} casts shadows`)
    assert.equal(obj.receiveShadow, true, `${name} receives shadows`)
  }

  disposePlayer(player)
  disposeAllSharedPools()
  console.log('✓ 16-pivot rig, hierarchy, anatomical meshes & legacy aliases verified')
}

// ---------------------------------------------------------------------------
// 2. Dimensions (~1.80m), Grounding (y=0), -Z Facing, Chest Clearance & Backpack
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Standing height (~1.80m), feet at Y=0, -Z facing, chest clearance & backpack')
  disposeAllSharedPools()

  const player = buildPlayer()
  player.updateMatrixWorld(true)

  const totalBox = new THREE.Box3().setFromObject(player)
  const totalHeight = totalBox.max.y - totalBox.min.y
  assert.ok(
    Math.abs(totalBox.min.y) < 0.015,
    `Root origin sits cleanly at feet (min.y=${totalBox.min.y.toFixed(4)})`
  )
  assert.ok(
    totalHeight >= 1.74 && totalHeight <= 1.86,
    `Total character height ~1.80m (actual=${totalHeight.toFixed(4)}m)`
  )

  // Eyes sit near configured eyeHeight (1.65m)
  const scleraBounds = computeMeshWorldBounds(
    player.getObjectByName('maze-player-eyes-sclera'),
    player
  )
  const eyeCenterY = (scleraBounds.min.y + scleraBounds.max.y) * 0.5
  assert.ok(
    Math.abs(eyeCenterY - DEFAULT_PLAYER_MODEL_CONFIG.eyeHeight) < 0.04,
    `Eye height matches ~1.65m (actual=${eyeCenterY.toFixed(4)}m)`
  )

  // Character faces -Z: eyes/lips & boot toes project forward into -Z
  const lipsBounds = computeMeshWorldBounds(
    player.getObjectByName('maze-player-lips'),
    player
  )
  const leftBootBounds = computeMeshWorldBounds(
    player.getObjectByName('maze-player-boot-left'),
    player
  )
  assert.ok(
    scleraBounds.max.z < 0 && lipsBounds.max.z < 0,
    `Face features orient forward (-Z) (lips max.z=${lipsBounds.max.z.toFixed(4)})`
  )
  assert.ok(
    leftBootBounds.min.z < -0.11 && Math.abs(leftBootBounds.min.z) > leftBootBounds.max.z,
    `Boots point toward -Z (min.z=${leftBootBounds.min.z.toFixed(4)}, max.z=${leftBootBounds.max.z.toFixed(4)})`
  )

  // Chest geometry stays clear of 3rd-person spotlight at z = -0.45
  const torsoBounds = computeMeshWorldBounds(
    player.getObjectByName('maze-player-torso-jacket'),
    player
  )
  const torsoHardwareBounds = computeMeshWorldBounds(
    player.getObjectByName('maze-player-torso-hardware'),
    player
  )
  const frontMostChestZ = Math.min(torsoBounds.min.z, torsoHardwareBounds.min.z)
  assert.ok(
    frontMostChestZ > -0.25,
    `Chest stays well behind third-person spotlight z=-0.45 (frontMostChestZ=${frontMostChestZ.toFixed(4)})`
  )

  // Neck integrates cleanly into collar/trapezius and jaw with ~3-5cm visible front/side span
  const neckMesh = player.getObjectByName('maze-player-neck')
  const torsoMesh = player.getObjectByName('maze-player-torso-jacket')
  const headMesh = player.getObjectByName('maze-player-head-skin')
  const neckBounds = computeMeshWorldBounds(neckMesh, player)
  const headSkinBounds = computeMeshWorldBounds(headMesh, player)
  const neckOverlapIntoTorso = torsoBounds.max.y - neckBounds.min.y
  const neckOverlapIntoHead = neckBounds.max.y - headSkinBounds.min.y
  assert.ok(
    neckOverlapIntoTorso >= 0.05 && neckOverlapIntoHead >= 0.015,
    `Neck overlaps cleanly inside collar (${neckOverlapIntoTorso.toFixed(4)}m) and jaw (${neckOverlapIntoHead.toFixed(4)}m)`
  )
  assert.ok(
    headSkinBounds.min.y > torsoBounds.max.y,
    `Chin clears highest collar rim (${(headSkinBounds.min.y - torsoBounds.max.y).toFixed(4)}m)`
  )

  const measureZoneExposedNeck = (pred) => {
    const jPos = torsoMesh.geometry.attributes.position
    const hPos = headMesh.geometry.attributes.position
    let collarMaxY = -Infinity
    let jawMinY = Infinity
    const v = new THREE.Vector3()
    for (let i = 0; i < jPos.count; i += 1) {
      v.set(jPos.getX(i), jPos.getY(i), jPos.getZ(i)).applyMatrix4(torsoMesh.matrixWorld)
      if (v.y > 1.2 && pred(v) && v.y > collarMaxY) collarMaxY = v.y
    }
    for (let i = 0; i < hPos.count; i += 1) {
      v.set(hPos.getX(i), hPos.getY(i), hPos.getZ(i)).applyMatrix4(headMesh.matrixWorld)
      if (pred(v) && v.y < jawMinY) jawMinY = v.y
    }
    return jawMinY - collarMaxY
  }
  const frontExposedNeck = measureZoneExposedNeck((v) => Math.abs(v.x) < 0.03 && v.z < -0.03)
  const sideExposedNeck = measureZoneExposedNeck((v) => Math.abs(v.x) >= 0.04 && Math.abs(v.z) <= 0.03)
  assert.ok(
    frontExposedNeck >= 0.025 && frontExposedNeck <= 0.05,
    `Front visible neck above collar is naturally short (actual=${(frontExposedNeck * 100).toFixed(2)}cm)`
  )
  assert.ok(
    sideExposedNeck >= 0.025 && sideExposedNeck <= 0.055,
    `Side visible neck above collar is naturally short (actual=${(sideExposedNeck * 100).toFixed(2)}cm)`
  )

  // Backpack sits flush against +Z back curvature with visible shoulder/chest harness straps
  const backpackBounds = computeMeshWorldBounds(
    player.getObjectByName('maze-player-backpack'),
    player
  )
  assert.ok(
    backpackBounds.max.z > 0.25 && backpackBounds.max.z > torsoBounds.max.z,
    `Backpack mounts behind torso on +Z (backpack max.z=${backpackBounds.max.z.toFixed(4)})`
  )
  const leftArmBounds = computeMeshWorldBounds(
    player.getObjectByName('maze-player-upper-arm-left'),
    player
  )
  assert.ok(
    backpackBounds.min.z < -0.1 && backpackBounds.max.y >= leftArmBounds.max.y,
    `Backpack harness straps wrap over shoulders onto front chest (min.z=${backpackBounds.min.z.toFixed(4)}, max.y=${backpackBounds.max.y.toFixed(4)}, shoulderMaxY=${leftArmBounds.max.y.toFixed(4)})`
  )

  disposePlayer(player)
  disposeAllSharedPools()
  console.log('✓ Proportions, grounding, -Z orientation, chest clearance & backpack verified')
}

// ---------------------------------------------------------------------------
// 3. Valid Geometry Attributes, Finite Vertex Buffers & Triangle Budget
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Finite geometry attributes, normals, UVs, colors & triangle count')
  disposeAllSharedPools()

  const player = buildPlayer()
  let totalTriangles = 0
  let meshCount = 0

  player.traverse((node) => {
    if (!node.isMesh) return
    meshCount += 1
    const geo = node.geometry
    assert.ok(geo instanceof THREE.BufferGeometry, `${node.name} uses BufferGeometry`)
    assert.ok(geo.attributes.position, `${node.name} has position attribute`)
    assert.ok(geo.attributes.normal, `${node.name} has normal attribute`)
    assert.ok(geo.attributes.uv, `${node.name} has uv attribute`)
    assert.ok(geo.attributes.color, `${node.name} has vertex color attribute`)
    assert.ok(geo.boundingBox, `${node.name} has boundingBox`)
    assert.ok(geo.boundingSphere, `${node.name} has boundingSphere`)

    for (const attrName of ['position', 'normal', 'uv', 'color']) {
      const arr = geo.attributes[attrName].array
      for (let i = 0; i < arr.length; i += 1) {
        assert.ok(
          Number.isFinite(arr[i]),
          `${node.name} ${attrName}[${i}] is finite`
        )
      }
    }

    // Verify normals are unit-length (non-degenerate faces)
    const norm = geo.attributes.normal
    for (let i = 0; i < norm.count; i += 1) {
      const len = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i))
      assert.ok(
        len > 0.9 && len < 1.1,
        `${node.name} normal[${i}] is normalized (len=${len.toFixed(4)})`
      )
    }

    if (geo.index) {
      const vCount = geo.attributes.position.count
      const idx = geo.index.array
      for (let i = 0; i < idx.length; i += 1) {
        assert.ok(
          Number.isInteger(idx[i]) && idx[i] >= 0 && idx[i] < vCount,
          `${node.name} index[${i}] in valid range`
        )
      }
    }

    totalTriangles += getTriangleCount(geo)
  })

  assert.equal(meshCount, player.userData.meshCount)
  assert.ok(
    totalTriangles >= 4500 && totalTriangles <= 20000,
    `Procedural explorer mesh has rich sculpted geometry (${totalTriangles} tris across ${meshCount} meshes)`
  )

  disposePlayer(player)
  disposeAllSharedPools()
  console.log(`✓ Geometry integrity verified (${totalTriangles} triangles, ${meshCount} meshes)`)
}

// ---------------------------------------------------------------------------
// 4. Legacy Positioning APIs, Palette Keys & Current PlayerAnimator Compat
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Public API compatibility (positioning, palette, PlayerAnimator, presets)')
  disposeAllSharedPools()

  for (const key of ['coat', 'trousers', 'gear', 'hardware', 'mask', 'accent', 'accentEmissive']) {
    assert.ok(Number.isInteger(PLAYER_PALETTE[key]), `PLAYER_PALETTE.${key} preserved`)
  }
  assert.equal(PLAYER_PALETTE.coat, 0x263347)

  const maze = generateMaze({ difficulty: 'small', seed: 4242 })
  const player = buildPlayer({
    maze,
    spawnCell: maze.start,
    yaw: 0.4,
    qualityPreset: 'performance',
  })
  assert.equal(player.userData.qualityPreset, 'performance')
  assert.equal(player.rotation.y, 0.4)

  const expectedStart = gridToWorld(maze.start.row, maze.start.col, maze)
  assert.ok(Math.abs(player.position.x - expectedStart.x) < 1e-6)
  assert.ok(Math.abs(player.position.z - expectedStart.z) < 1e-6)

  positionPlayerAtWorld(player, { x: 3.5, y: 0, z: -2.5 }, 1.25)
  assert.equal(player.position.x, 3.5)
  assert.equal(player.position.z, -2.5)
  assert.equal(player.rotation.y, 1.25)

  positionPlayerAtGrid(player, maze.exit.row, maze.exit.col, maze, { yaw: 0 })
  const expectedExit = gridToWorld(maze.exit.row, maze.exit.col, maze)
  assert.ok(Math.abs(player.position.x - expectedExit.x) < 1e-6)
  assert.ok(Math.abs(player.position.z - expectedExit.z) < 1e-6)

  // Verify existing PlayerAnimator works smoothly against legacy rig aliases
  const animator = new PlayerAnimator(player)
  for (let i = 0; i < 15; i += 1) {
    animator.update(0.016, {
      moved: true,
      isSprinting: false,
      actualSpeed: 5.5,
      walkSpeed: 5.5,
      sprintSpeed: 9.0,
    })
  }
  assert.equal(animator.getState().state, 'walk')
  assert.ok(Math.abs(player.userData.rig.leftHipPivot.rotation.x) > 0.01)

  animator.reset()
  assert.equal(animator.getState().state, 'idle')
  assert.equal(player.userData.rig.leftHipPivot.rotation.x, 0)

  animator.dispose()
  disposePlayer(player)
  disposeAllSharedPools()
  console.log('✓ Public API, positioning, qualityPreset & PlayerAnimator compat verified')
}

// ---------------------------------------------------------------------------
// 5. Material, Geometry & Shared Texture Disposal Lifecycle
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Geometry/material disposal & shared DataTexture pool lifecycle')
  disposeAllSharedPools()

  const player = buildPlayer({ qualityPreset: 'balanced' })
  const texBundle = getPlayerTextureSet({ qualityPreset: 'balanced' })
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 1, textures: 15 })

  const jacketMesh = player.getObjectByName('maze-player-torso-jacket')
  assert.equal(jacketMesh.material.map, texBundle.jacket.map)
  assert.equal(jacketMesh.material.bumpMap, texBundle.jacket.bumpMap)
  assert.equal(jacketMesh.material.roughnessMap, texBundle.jacket.roughnessMap)
  assert.equal(isSharedResource(jacketMesh.material.map), true)

  let geoDisposals = 0
  let matDisposals = 0
  let texDisposals = 0
  const seenGeo = new Set()
  const seenMat = new Set()
  const seenTex = new Set()

  player.traverse((node) => {
    if (!node.isMesh) return
    if (!seenGeo.has(node.geometry)) {
      seenGeo.add(node.geometry)
      const orig = node.geometry.dispose.bind(node.geometry)
      node.geometry.dispose = () => {
        geoDisposals += 1
        orig()
      }
    }
    if (!seenMat.has(node.material)) {
      seenMat.add(node.material)
      const orig = node.material.dispose.bind(node.material)
      node.material.dispose = () => {
        matDisposals += 1
        orig()
      }
      for (const k of ['map', 'bumpMap', 'roughnessMap']) {
        const t = node.material[k]
        if (t && !seenTex.has(t)) {
          seenTex.add(t)
          const origT = t.dispose.bind(t)
          t.dispose = () => {
            texDisposals += 1
            origT()
          }
        }
      }
    }
  })

  const parent = new THREE.Group()
  parent.add(player)

  assert.equal(disposePlayer(player), true)
  assert.equal(player.parent, null, 'disposePlayer detaches from parent')
  assert.equal(player.children.length, 0, 'disposePlayer clears children')
  assert.equal(geoDisposals, seenGeo.size, 'All unique geometries disposed')
  assert.equal(matDisposals, seenMat.size, 'All unique materials disposed')
  assert.equal(texDisposals, 0, 'Shared DataTextures stay pooled across player rebuilds')
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 1, textures: 15 })

  // Idempotent repeat disposal
  assert.equal(disposePlayer(player), true)
  assert.equal(geoDisposals, seenGeo.size, 'Repeat disposePlayer does not double-dispose')
  assert.equal(matDisposals, seenMat.size)

  // Engine-level shared pool cleanup disposes shared textures
  disposeAllSharedPools()
  assert.equal(texDisposals, seenTex.size, 'disposeAllSharedPools disposes shared textures')
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  console.log('✓ Disposal & shared texture pool lifecycle verified')
}

// ---------------------------------------------------------------------------
// 6. Phase 4 Sync Quality, Refcounted Pool Protection, Partial Disposal & Repeated Churn
// ---------------------------------------------------------------------------
{
  console.log('Test 6: syncPlayerQuality(), pool protection, partial cleanup & repeated create/dispose churn')
  disposeAllSharedPools()

  // A) syncPlayerQuality() swaps textures in-place across all 3 tiers without recreating geometry/materials
  const player = buildPlayer({ qualityPreset: 'performance' })
  assert.equal(getPlayerTexturePresetRefCount('performance'), 1)
  const jacketMesh = player.getObjectByName('maze-player-torso-jacket')
  const bootMesh = player.getObjectByName('maze-player-boot-left')
  const origGeo = jacketMesh.geometry
  const origMat = jacketMesh.material
  assert.equal(jacketMesh.material.map.image.width, 64)
  assert.equal(bootMesh.material.map.image.width, 64)

  // Live player protects performance pool from accidental non-forced cleanup
  disposePlayerTexturePools()
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 1, textures: 15 })

  syncPlayerQuality(player, 'balanced')
  assert.equal(player.userData.qualityPreset, 'balanced')
  assert.equal(jacketMesh.geometry, origGeo, 'syncPlayerQuality preserves geometry')
  assert.equal(jacketMesh.material, origMat, 'syncPlayerQuality updates material in-place')
  assert.equal(jacketMesh.material.map.image.width, 128)
  assert.equal(bootMesh.material.map.image.width, 128)
  assert.equal(getPlayerTexturePresetRefCount('performance'), 0)
  assert.equal(getPlayerTexturePresetRefCount('balanced'), 1)

  syncPlayerQuality(player, 'high')
  assert.equal(player.userData.qualityPreset, 'high')
  assert.equal(jacketMesh.material.map.image.width, 256)
  assert.equal(bootMesh.material.map.image.width, 256)
  assert.equal(getPlayerTexturePresetRefCount('balanced'), 0)
  assert.equal(getPlayerTexturePresetRefCount('high'), 1)

  // Non-forced disposePlayerTexturePools prunes unreferenced performance/balanced while preserving high
  disposePlayerTexturePools()
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 1, textures: 15 })

  const pelvisPivot = player.userData.rig.pelvisPivot
  disposePlayer(player)
  assert.equal(player.userData.isDisposed, true)
  assert.equal(player.userData.rig, null)
  assert.equal(player.userData.materials, null)
  assert.equal(pelvisPivot.children.length, 0, 'disposePlayer clears nested child pivot groups')
  assert.equal(getPlayerTexturePresetRefCount('high'), 0)
  assert.equal(syncPlayerQuality(player, 'balanced'), null, 'syncPlayerQuality ignores disposed player')

  // B) Partial / malformed player group safety & non-shared custom texture disposal
  let customGeoDisposed = 0
  let customMatDisposed = 0
  let customTexDisposed = 0
  const partialGroup = new THREE.Group()
  const partialGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1)
  partialGeo.dispose = () => {
    customGeoDisposed += 1
  }
  const customTex = new THREE.DataTexture(new Uint8Array(16), 2, 2)
  customTex.dispose = () => {
    customTexDisposed += 1
  }
  const partialMat = new THREE.MeshStandardMaterial({ map: customTex })
  partialMat.dispose = () => {
    customMatDisposed += 1
  }
  partialGroup.add(new THREE.Mesh(partialGeo, partialMat))
  assert.equal(disposePlayer(partialGroup), true)
  assert.equal(customGeoDisposed, 1)
  assert.equal(customMatDisposed, 1)
  assert.equal(customTexDisposed, 1)
  assert.equal(disposePlayer(null), false)
  assert.equal(disposePlayer({}), true)

  // C) 20 create/dispose cycles accumulate zero leaked geometries/materials/pools
  disposeAllSharedPools()
  for (let i = 0; i < 20; i += 1) {
    const preset = i % 3 === 0 ? 'performance' : i % 3 === 1 ? 'balanced' : 'high'
    const p = buildPlayer({ qualityPreset: preset })
    disposePlayer(p)
  }
  assert.equal(getPlayerTexturePresetRefCount('performance'), 0)
  assert.equal(getPlayerTexturePresetRefCount('balanced'), 0)
  assert.equal(getPlayerTexturePresetRefCount('high'), 0)
  disposePlayerTexturePools()
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  console.log('✓ syncPlayerQuality, pool protection, partial disposal & zero-leak churn verified')
}

console.log('=== ALL PHASE 2 PLAYER MODEL TESTS PASSED! ===')
