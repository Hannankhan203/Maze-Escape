import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MAZE_MESH_PALETTE } from './buildMazeMeshes.js'
import { PLAYER_PALETTE as LEGACY_PLAYER_PALETTE } from './buildPlayer.js'
import {
  PLAYER_MATERIAL_SPECS,
  PLAYER_PALETTE,
  PLAYER_TEXTURE_KEYS,
  PLAYER_TEXTURE_QUALITY_PRESETS,
  disposePlayerTexturePools,
  getPlayerTexturePoolStats,
  getPlayerTexturePresetRefCount,
  getPlayerTextureSet,
  pruneUnusedPlayerTexturePools,
  releasePlayerTexturePreset,
  resolvePlayerTextureQualityPreset,
  retainPlayerTexturePreset,
} from './playerTextures.js'
import {
  disposeAllSharedPools,
  isSharedResource,
} from './sharedResources.js'

console.log('--- RUNNING PROCEDURAL PLAYER TEXTURE TESTS (PHASE 1) ---')

function getLinearLuminance(hex) {
  const c = new THREE.Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

function summarizeRgbaBuffer(bytes) {
  let minLum = 255
  let maxLum = 0
  let sumLum = 0
  const pxCount = bytes.length / 4
  for (let i = 0; i < bytes.length; i += 4) {
    const r = bytes[i]
    const g = bytes[i + 1]
    const b = bytes[i + 2]
    const a = bytes[i + 3]
    assert.ok(Number.isInteger(r) && r >= 0 && r <= 255, 'R byte in [0, 255]')
    assert.ok(Number.isInteger(g) && g >= 0 && g <= 255, 'G byte in [0, 255]')
    assert.ok(Number.isInteger(b) && b >= 0 && b <= 255, 'B byte in [0, 255]')
    assert.equal(a, 255, 'Alpha channel must be opaque 255')
    const lum = (r + g + b) / 3
    if (lum < minLum) minLum = lum
    if (lum > maxLum) maxLum = lum
    sumLum += lum
  }
  return {
    minLum,
    maxLum,
    meanLum: sumLum / pxCount,
    spread: maxLum - minLum,
  }
}

// ---------------------------------------------------------------------------
// 1. Palette & Material Spec Contract
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Legacy PLAYER_PALETTE keys, coat luminance contract & material specs')

  for (const [key, hex] of Object.entries(LEGACY_PLAYER_PALETTE)) {
    assert.equal(
      PLAYER_PALETTE[key],
      hex,
      `PLAYER_PALETTE.${key} preserves exact legacy value 0x${hex.toString(16)}`
    )
  }

  const floorLum = getLinearLuminance(MAZE_MESH_PALETTE.floor)
  const coatLum = getLinearLuminance(PLAYER_PALETTE.coat)
  assert.ok(
    coatLum > floorLum,
    `Coat linear luminance (${coatLum.toFixed(4)}) exceeds floor (${floorLum.toFixed(4)})`
  )

  for (const extraKey of [
    'skin',
    'skinShadow',
    'lips',
    'hair',
    'eyesSclera',
    'eyesIris',
    'boots',
    'gloves',
    'backpack',
  ]) {
    assert.ok(
      Number.isInteger(PLAYER_PALETTE[extraKey]),
      `PLAYER_PALETTE.${extraKey} is defined as a hex integer`
    )
  }

  for (const [specName, spec] of Object.entries(PLAYER_MATERIAL_SPECS)) {
    assert.ok(Number.isInteger(spec.color), `Spec ${specName} defines hex color`)
    assert.ok(
      spec.roughness >= 0 && spec.roughness <= 1,
      `Spec ${specName} roughness within [0, 1]`
    )
    assert.ok(
      spec.metalness >= 0 && spec.metalness <= 1,
      `Spec ${specName} metalness within [0, 1]`
    )
    if (spec.textureKey !== null) {
      assert.ok(
        PLAYER_TEXTURE_KEYS.includes(spec.textureKey),
        `Spec ${specName} references valid textureKey (${spec.textureKey})`
      )
    }
  }

  console.log('✓ Palette and material specification contracts verified')
}

// ---------------------------------------------------------------------------
// 2. Quality Presets, Dimensions, Color Space & Data Validity
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Quality presets, DataTexture dimensions, color spaces & buffer validity')

  disposePlayerTexturePools()
  assert.equal(resolvePlayerTextureQualityPreset('performance'), 'performance')
  assert.equal(resolvePlayerTextureQualityPreset('balanced'), 'balanced')
  assert.equal(resolvePlayerTextureQualityPreset('high'), 'high')
  assert.equal(resolvePlayerTextureQualityPreset('unknown-tier'), 'high')
  assert.equal(resolvePlayerTextureQualityPreset(undefined), 'high')

  const expectedSizes = {
    performance: 64,
    balanced: 128,
    high: 256,
  }

  for (const preset of ['performance', 'balanced', 'high']) {
    const bundle = getPlayerTextureSet({ qualityPreset: preset })
    const expectedSize = expectedSizes[preset]
    assert.equal(bundle.qualityPreset, preset)
    assert.equal(bundle.presetSpec.albedoSize, expectedSize)
    assert.equal(bundle.presetSpec.detailSize, expectedSize)

    for (const surfaceKey of PLAYER_TEXTURE_KEYS) {
      const entry = bundle[surfaceKey]
      assert.ok(entry, `Surface bundle ${surfaceKey} exists for ${preset}`)

      const maps = [
        { name: 'map', tex: entry.map, colorSpace: THREE.SRGBColorSpace },
        { name: 'bumpMap', tex: entry.bumpMap, colorSpace: THREE.NoColorSpace },
        { name: 'roughnessMap', tex: entry.roughnessMap, colorSpace: THREE.NoColorSpace },
      ]

      for (const { name, tex, colorSpace } of maps) {
        assert.ok(tex instanceof THREE.DataTexture, `${surfaceKey}.${name} is DataTexture`)
        assert.equal(tex.colorSpace, colorSpace, `${surfaceKey}.${name} colorSpace`)
        assert.equal(tex.format, THREE.RGBAFormat)
        assert.equal(tex.type, THREE.UnsignedByteType)
        assert.equal(tex.wrapS, THREE.RepeatWrapping)
        assert.equal(tex.wrapT, THREE.RepeatWrapping)
        assert.equal(tex.magFilter, THREE.LinearFilter)
        assert.equal(tex.minFilter, THREE.LinearMipmapLinearFilter)
        assert.equal(tex.generateMipmaps, true)
        assert.equal(tex.anisotropy, PLAYER_TEXTURE_QUALITY_PRESETS[preset].anisotropyCap)
        assert.equal(tex.image.width, expectedSize, `${surfaceKey}.${name} width`)
        assert.equal(tex.image.height, expectedSize, `${surfaceKey}.${name} height`)
        assert.ok(tex.image.data instanceof Uint8Array, `${surfaceKey}.${name} uses Uint8Array`)
        assert.equal(
          tex.image.data.length,
          expectedSize * expectedSize * 4,
          `${surfaceKey}.${name} RGBA byte length`
        )
        assert.equal(isSharedResource(tex), true, `${surfaceKey}.${name} marked shared`)

        const stats = summarizeRgbaBuffer(tex.image.data)
        assert.ok(
          stats.spread >= 4,
          `${surfaceKey}.${name} (${preset}) has non-trivial surface detail (spread=${stats.spread.toFixed(1)})`
        )
        if (name === 'map') {
          assert.ok(
            stats.meanLum > 180,
            `${surfaceKey}.map multiplicative detail stays near-neutral (${stats.meanLum.toFixed(1)})`
          )
        }
      }
    }
  }

  // Verify performance footprint stays significantly smaller than high
  const perfTex = getPlayerTextureSet({ qualityPreset: 'performance' }).jacket.map
  const highTex = getPlayerTextureSet({ qualityPreset: 'high' }).jacket.map
  assert.equal(
    highTex.image.data.length / perfTex.image.data.length,
    16,
    'High preset uses 16x byte size vs performance (256^2 vs 64^2)'
  )

  console.log('✓ All quality presets and texture maps validated')
}

// ---------------------------------------------------------------------------
// 3. Deterministic Generation Across Pool Resets
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Deterministic byte-for-byte texture output')

  disposePlayerTexturePools()
  const firstRun = getPlayerTextureSet({ qualityPreset: 'balanced' })
  const snapshot = {}
  for (const key of PLAYER_TEXTURE_KEYS) {
    snapshot[key] = {
      map: new Uint8Array(firstRun[key].map.image.data),
      bump: new Uint8Array(firstRun[key].bumpMap.image.data),
      rough: new Uint8Array(firstRun[key].roughnessMap.image.data),
    }
  }

  disposePlayerTexturePools()
  const secondRun = getPlayerTextureSet({ qualityPreset: 'balanced' })

  for (const key of PLAYER_TEXTURE_KEYS) {
    assert.deepEqual(
      secondRun[key].map.image.data,
      snapshot[key].map,
      `${key}.map bytes are deterministic across rebuilds`
    )
    assert.deepEqual(
      secondRun[key].bumpMap.image.data,
      snapshot[key].bump,
      `${key}.bumpMap bytes are deterministic across rebuilds`
    )
    assert.deepEqual(
      secondRun[key].roughnessMap.image.data,
      snapshot[key].rough,
      `${key}.roughnessMap bytes are deterministic across rebuilds`
    )
  }

  console.log('✓ Deterministic output verified')
}

// ---------------------------------------------------------------------------
// 4. Shared Pooling, Idempotent Disposal & Global Cleanup Integration
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Shared pooling, idempotent disposal & sharedResources integration')

  disposeAllSharedPools()
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  const bundleA = getPlayerTextureSet({ qualityPreset: 'high' })
  const bundleB = getPlayerTextureSet({ qualityPreset: 'high' })
  assert.equal(bundleA, bundleB, 'Repeated calls return exact cached preset bundle')
  assert.equal(bundleA.skin.map, bundleB.skin.map, 'Repeated calls reuse exact DataTexture instances')
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 1, textures: 15 })

  getPlayerTextureSet({ qualityPreset: 'performance' })
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 2, textures: 30 })

  let disposeCalls = 0
  const prevSkinMap = bundleA.skin.map
  const origDispose = prevSkinMap.dispose.bind(prevSkinMap)
  prevSkinMap.dispose = () => {
    disposeCalls += 1
    origDispose()
  }

  // Global shared pool cleanup (used by MazeSceneEngine.dispose()) must dispose player textures
  disposeAllSharedPools()
  assert.equal(disposeCalls, 1, 'disposeAllSharedPools() disposes cached player textures once')
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  // Idempotent repeat disposal
  disposePlayerTexturePools()
  disposePlayerTexturePools()
  assert.equal(disposeCalls, 1, 'Repeated pool disposal is safe and idempotent')
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  // Subsequent rebuild succeeds cleanly with fresh instances
  const rebuilt = getPlayerTextureSet({ qualityPreset: 'high' })
  assert.notEqual(rebuilt.skin.map, prevSkinMap, 'Post-disposal call allocates fresh DataTexture')
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 1, textures: 15 })

  disposeAllSharedPools()
  console.log('✓ Pooling and idempotent cleanup verified')
}

// ---------------------------------------------------------------------------
// 5. Reference-Counted Preset Ownership Protection & Selective Pruning
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Reference-counted ownership protection & selective pruning')

  disposeAllSharedPools()
  const ownerA = { id: 'player-a' }
  const ownerB = { id: 'player-b' }

  const perfBundle = getPlayerTextureSet({ qualityPreset: 'performance' })
  const highBundle = getPlayerTextureSet({ qualityPreset: 'high' })
  retainPlayerTexturePreset('performance', ownerA)
  retainPlayerTexturePreset('performance', ownerB)
  assert.equal(getPlayerTexturePresetRefCount('performance'), 2)
  assert.equal(getPlayerTexturePresetRefCount('high'), 0)

  let perfDisposals = 0
  const origPerfDispose = perfBundle.jacket.map.dispose.bind(perfBundle.jacket.map)
  perfBundle.jacket.map.dispose = () => {
    perfDisposals += 1
    origPerfDispose()
  }

  let highDisposals = 0
  const origHighDispose = highBundle.jacket.map.dispose.bind(highBundle.jacket.map)
  highBundle.jacket.map.dispose = () => {
    highDisposals += 1
    origHighDispose()
  }

  // Non-forced disposePlayerTexturePools() must NOT dispose still-retained 'performance' textures,
  // while pruning unreferenced 'high' textures cleanly.
  disposePlayerTexturePools()
  assert.equal(perfDisposals, 0, 'Retained performance textures survive non-forced pool cleanup')
  assert.equal(highDisposals, 1, 'Unreferenced high textures are disposed cleanly')
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 1, textures: 15 })

  // Releasing one owner leaves refCount === 1 and still protects 'performance'
  assert.equal(releasePlayerTexturePreset(ownerA, 'performance'), 1)
  assert.equal(pruneUnusedPlayerTexturePools('balanced'), 0)
  assert.equal(perfDisposals, 0)

  // Releasing final owner allows non-forced cleanup/pruning to dispose 'performance'
  assert.equal(releasePlayerTexturePreset(ownerB, 'performance'), 0)
  assert.equal(pruneUnusedPlayerTexturePools('balanced'), 1)
  assert.equal(perfDisposals, 1, 'Released performance textures dispose when unreferenced')
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  // Force disposal clears even retained bundles on global shutdown
  getPlayerTextureSet({ qualityPreset: 'balanced' })
  retainPlayerTexturePreset('balanced', ownerA)
  disposePlayerTexturePools({ force: true })
  assert.equal(getPlayerTexturePresetRefCount('balanced'), 0)
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  console.log('✓ Ownership refcounting & selective pruning verified')
}

console.log('=== ALL PHASE 1 PLAYER TEXTURE TESTS PASSED! ===')
