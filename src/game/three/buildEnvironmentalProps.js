import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'
import { placeEnvironmentalProps, PROP_TYPES } from '../generation/environmentalPropPlacement.js'
import { mergeIndexedGeometries } from './geometryOptimization.js'
import {
  TEXTURE_QUALITY_PRESETS,
  getMazeSurfaceTextureSet,
  resolveTextureQualityPreset,
} from './mazeSurfaceTextures.js'
import {
  markSharedResource,
  registerSharedPoolClearer,
  registerTextureAnisotropySyncer,
} from './sharedResources.js'
import { createMazeChunkLayout } from './spatialChunking.js'

const propTexturePool = new Map()
const propMaterialPool = new Map()
const propGeometryPool = new Map()
const propPrototypeCache = new Map()

/**
 * Calibrated abandoned-facility PBR palette & material parameters.
 * Albedo values stay subdued to harmonize with the dark slate vault
 * (`0x1c283d` floor / `0x2f405b` walls) and react naturally to the flashlight.
 */
export const PROP_MATERIAL_PALETTE = {
  rustyMetal: {
    color: 0x3b2820, // Dark oxidized matte iron-oxide
    roughness: 0.95,
    metalness: 0.14,
    envMapIntensity: 0.22,
    bumpScale: 0.032,
  },
  darkSteel: {
    color: 0x262f3b, // Aged, dusty structural steel
    roughness: 0.89,
    metalness: 0.32,
    envMapIntensity: 0.28,
    bumpScale: 0.022,
  },
  weatheredWood: {
    color: 0x45352a, // Dark damp-stained timber
    roughness: 0.94,
    metalness: 0.02,
    envMapIntensity: 0.22,
    bumpScale: 0.036,
  },
  cabinetGreen: {
    color: 0x2a3731, // Faded, dusty institutional olive-grey
    roughness: 0.91,
    metalness: 0.12,
    envMapIntensity: 0.25,
    bumpScale: 0.024,
  },
  lockerBlue: {
    color: 0x222d3a, // Muted, desaturated cold slate
    roughness: 0.91,
    metalness: 0.15,
    envMapIntensity: 0.25,
    bumpScale: 0.024,
  },
  warningYellow: {
    color: 0x56462b, // Heavily faded industrial ochre (never bright gold/yellow)
    roughness: 0.92,
    metalness: 0.1,
    envMapIntensity: 0.24,
    bumpScale: 0.028,
  },
  paperWhite: {
    color: 0x777060, // Dirty, yellowed, moisture-stained file paper
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.18,
    bumpScale: 0.015,
  },
  debrisConcrete: {
    color: 0x2b394e, // Dark rubble consistent with maze walls/floors
    roughness: 0.95,
    metalness: 0.02,
    envMapIntensity: 0.34,
    bumpScale: 0.048,
  },
  cableBlack: {
    color: 0x1a1f27, // Matte aged dark rubber cable
    roughness: 0.9,
    metalness: 0.04,
    envMapIntensity: 0.22,
    bumpScale: 0.02,
  },
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function hash2i(ix, iy, seed = 6131) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

function samplePeriodicNoise(u, v, periodX, periodY, seed) {
  const uWrap = u >= 0 && u < 1 ? u : ((u % 1) + 1) % 1
  const vWrap = v >= 0 && v < 1 ? v : ((v % 1) + 1) % 1
  const fx = uWrap * periodX
  const fy = vWrap * periodY
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)

  const ix0 = x0 < periodX ? x0 : x0 % periodX
  const ix1 = ix0 + 1 < periodX ? ix0 + 1 : 0
  const iy0 = y0 < periodY ? y0 : y0 % periodY
  const iy1 = iy0 + 1 < periodY ? iy0 + 1 : 0

  const n00 = hash2i(ix0, iy0, seed)
  const n10 = hash2i(ix1, iy0, seed)
  const n01 = hash2i(ix0, iy1, seed)
  const n11 = hash2i(ix1, iy1, seed)
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy)
}

function samplePeriodicFbm(u, v, basePeriod, octaves, seed, periodYScale = 1) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let freq = basePeriod
  for (let o = 0; o < octaves; o += 1) {
    const py = Math.max(1, Math.round(freq * periodYScale))
    sum += amp * samplePeriodicNoise(u, v, freq, py, seed + o * 89)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm : 0.5
}

function createPropDataTexture(bytes, size, colorSpace, presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat)
  tex.colorSpace = colorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = presetSpec.anisotropyCap
  tex.userData.qualityPreset = presetSpec.id
  tex.needsUpdate = true
  return markSharedResource(tex)
}

function writeRgbTexel(buf, offset, r, g, b) {
  buf[offset] = Math.round(clamp(r, 0.04, 0.98) * 255)
  buf[offset + 1] = Math.round(clamp(g, 0.04, 0.98) * 255)
  buf[offset + 2] = Math.round(clamp(b, 0.04, 0.98) * 255)
  buf[offset + 3] = 255
}

function writeScalarTexel(buf, offset, val) {
  const byte = Math.round(clamp(val, 0.04, 0.99) * 255)
  buf[offset] = byte
  buf[offset + 1] = byte
  buf[offset + 2] = byte
  buf[offset + 3] = 255
}

/**
 * Builds 5 lightweight preset-scaled (256/128/64) seamless procedural texture trios
 * (albedo, roughness, bump) shared across prop materials. Concrete debris reuses
 * the architectural wall concrete maps.
 */
function buildProceduralPropTextures(presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const size = presetSpec.propSize
  const plankSeamBand = Math.max(0.028, 1.8 / size)
  const creaseBand = Math.max(0.02, 1.3 / size)
  const pxCount = size * size

  const allocTrio = () => ({
    albedo: new Uint8Array(pxCount * 4),
    rough: new Uint8Array(pxCount * 4),
    bump: new Uint8Array(pxCount * 4),
  })

  const rustSet = allocTrio()
  const steelSet = allocTrio()
  const paintSet = allocTrio()
  const woodSet = allocTrio()
  const paperSet = allocTrio()

  for (let py = 0; py < size; py += 1) {
    const v = py / size
    for (let px = 0; px < size; px += 1) {
      const u = px / size
      const off = (py * size + px) * 4
      const micro = hash2i(px, py, 9101) - 0.5

      // 1. Oxidized rusty metal: rust mottling, flaky pitting, dust & scratches
      {
        const mottle = samplePeriodicFbm(u, v, 4, 3, 1201)
        const scalePatch = samplePeriodicFbm(u + 0.17, v + 0.31, 8, 3, 1259)
        const pit = smoothstep(0.68, 0.92, scalePatch)
        const scratch = smoothstep(
          0.83,
          0.95,
          samplePeriodicNoise(u * 1.4 + v * 0.45, v * 0.25, 22, 22, 1297)
        )
        const dust = smoothstep(0.52, 0.86, mottle) * 0.36

        let lum = 0.85 + (mottle - 0.5) * 0.2 - pit * 0.14 + scratch * 0.07 + micro * 0.04
        lum = lerp(lum, 0.78, dust)
        const r = lum * (1.03 + pit * 0.05)
        const g = lum * (0.98 - pit * 0.04)
        const b = lum * (0.93 - pit * 0.08)
        writeRgbTexel(rustSet.albedo, off, r, g, b)

        const roughVal = clamp(0.92 + mottle * 0.05 + pit * 0.04 - scratch * 0.06 + micro * 0.02, 0.86, 0.99)
        const bumpVal = clamp(0.54 - pit * 0.32 - scratch * 0.12 + (mottle - 0.5) * 0.1 + micro * 0.06, 0.08, 0.92)
        writeScalarTexel(rustSet.rough, off, roughVal)
        writeScalarTexel(rustSet.bump, off, bumpVal)
      }

      // 2. Aged dusty steel & matte rubber cable: brushed grain, dust mottling, fine scuffs
      {
        const dustFbm = samplePeriodicFbm(u, v, 3, 3, 2111)
        const grain = (samplePeriodicNoise(u * 0.5, v * 5.0, 16, 16, 2143) - 0.5) * 0.05
        const scratch = smoothstep(
          0.84,
          0.96,
          samplePeriodicNoise(u * 1.2 - v * 0.3, v * 0.3, 24, 24, 2179)
        )
        const smudge = smoothstep(0.5, 0.85, dustFbm)

        const lum = 0.86 + grain + (dustFbm - 0.5) * 0.14 + scratch * 0.07 - smudge * 0.05 + micro * 0.03
        writeRgbTexel(steelSet.albedo, off, lum * 0.98, lum * 0.99, lum * 1.02)

        const roughVal = clamp(0.91 + smudge * 0.06 - scratch * 0.06 + micro * 0.02, 0.85, 0.99)
        const bumpVal = clamp(0.5 + grain * 0.8 - scratch * 0.14 + (dustFbm - 0.5) * 0.08 + micro * 0.04, 0.15, 0.85)
        writeScalarTexel(steelSet.rough, off, roughVal)
        writeScalarTexel(steelSet.bump, off, bumpVal)
      }

      // 3. Uneven aged institutional paint: faded chalking, grime streaks, chipped oxide specks
      {
        const chalkFbm = samplePeriodicFbm(u, v, 4, 3, 3109)
        const streak = samplePeriodicFbm(u, v * 0.35, 8, 2, 3163)
        const chipMask = smoothstep(0.76, 0.92, samplePeriodicFbm(u + 0.29, v + 0.13, 7, 3, 3203))
        const grime = smoothstep(0.55, 0.88, streak) * 0.32

        const lum = 0.87 + (chalkFbm - 0.5) * 0.16 - grime * 0.14 - chipMask * 0.18 + micro * 0.03
        const r = lerp(lum, lum * 0.94, chipMask * 0.4)
        const g = lerp(lum, lum * 0.86, chipMask * 0.55)
        const b = lerp(lum, lum * 0.78, chipMask * 0.65)
        writeRgbTexel(paintSet.albedo, off, r, g, b)

        const roughVal = clamp(0.91 + chalkFbm * 0.05 + chipMask * 0.05 + micro * 0.02, 0.86, 0.99)
        const bumpVal = clamp(0.54 - chipMask * 0.28 + (chalkFbm - 0.5) * 0.1 + micro * 0.04, 0.12, 0.88)
        writeScalarTexel(paintSet.rough, off, roughVal)
        writeScalarTexel(paintSet.bump, off, bumpVal)
      }

      // 4. Weathered water-stained wood: longitudinal fiber grain, plank seams, damp blotches
      {
        const fiberWarp = samplePeriodicFbm(u, v, 3, 2, 4111) * 0.12
        const grainWave = Math.sin((u * 14 + fiberWarp * 8) * Math.PI * 2) * 0.5 + 0.5
        const fineFiber = samplePeriodicNoise(u * 4.0, v * 0.35, 24, 12, 4153)
        const plankSeam = 1 - smoothstep(0.0, plankSeamBand, Math.min((u * 3) % 1, 1 - ((u * 3) % 1)))
        const waterStain = smoothstep(0.56, 0.84, samplePeriodicFbm(u + 0.33, v + 0.41, 3, 3, 4199))

        let lum = 0.84 + (grainWave - 0.5) * 0.12 + (fineFiber - 0.5) * 0.12 - plankSeam * 0.22 + micro * 0.03
        lum = lerp(lum, lum * 0.72, waterStain * 0.58)
        writeRgbTexel(woodSet.albedo, off, lum * 1.02, lum * 0.97, lum * 0.91)

        const roughVal = clamp(0.92 + waterStain * 0.05 + plankSeam * 0.04 + micro * 0.02, 0.88, 0.99)
        const bumpVal = clamp(0.52 + (grainWave - 0.5) * 0.16 + (fineFiber - 0.5) * 0.12 - plankSeam * 0.32 + micro * 0.04, 0.1, 0.9)
        writeScalarTexel(woodSet.rough, off, roughVal)
        writeScalarTexel(woodSet.bump, off, bumpVal)
      }

      // 5. Dirty moisture-stained paper: fiber mottling, damp tide rings, crease/soot smudges
      {
        const pulp = samplePeriodicFbm(u, v, 5, 3, 5107)
        const ringNoise = samplePeriodicFbm(u + 0.11, v + 0.23, 3, 3, 5147)
        const tideRing = Math.exp(-Math.pow((ringNoise - 0.62) / 0.06, 2))
        const soot = smoothstep(0.58, 0.88, samplePeriodicFbm(u + 0.47, v + 0.09, 4, 2, 5189))
        const crease = 1 - smoothstep(0.0, creaseBand, Math.abs(((u + v * 0.6) % 1) - 0.5))

        const lum = 0.86 + (pulp - 0.5) * 0.12 - tideRing * 0.16 - soot * 0.18 - crease * 0.08 + micro * 0.025
        writeRgbTexel(
          paperSet.albedo,
          off,
          lum * (1.03 - soot * 0.04),
          lum * (0.99 - tideRing * 0.05),
          lum * (0.9 - tideRing * 0.09)
        )

        const roughVal = clamp(0.95 + pulp * 0.03 + soot * 0.02, 0.92, 0.99)
        const bumpVal = clamp(0.5 + (pulp - 0.5) * 0.1 - crease * 0.18 + micro * 0.03, 0.2, 0.8)
        writeScalarTexel(paperSet.rough, off, roughVal)
        writeScalarTexel(paperSet.bump, off, bumpVal)
      }
    }
  }

  const preset = presetSpec.id
  const finalizeSet = (key, trio) => {
    const bundle = {
      map: createPropDataTexture(trio.albedo, size, THREE.SRGBColorSpace, presetSpec),
      roughnessMap: createPropDataTexture(trio.rough, size, THREE.NoColorSpace, presetSpec),
      bumpMap: createPropDataTexture(trio.bump, size, THREE.NoColorSpace, presetSpec),
    }
    propTexturePool.set(`${preset}:${key}`, bundle)
    return bundle
  }

  return {
    rustMetal: finalizeSet('tex:rustMetal', rustSet),
    steelGrime: finalizeSet('tex:steelGrime', steelSet),
    agedPaint: finalizeSet('tex:agedPaint', paintSet),
    weatheredWood: finalizeSet('tex:weatheredWood', woodSet),
    stainedPaper: finalizeSet('tex:stainedPaper', paperSet),
  }
}

export function getEnvironmentalPropTextureSet(options = {}) {
  const preset = resolveTextureQualityPreset(options?.qualityPreset)
  const presetSpec = TEXTURE_QUALITY_PRESETS[preset]
  if (!propTexturePool.has(`${preset}:tex:rustMetal`)) {
    return buildProceduralPropTextures(presetSpec)
  }
  return {
    rustMetal: propTexturePool.get(`${preset}:tex:rustMetal`),
    steelGrime: propTexturePool.get(`${preset}:tex:steelGrime`),
    agedPaint: propTexturePool.get(`${preset}:tex:agedPaint`),
    weatheredWood: propTexturePool.get(`${preset}:tex:weatheredWood`),
    stainedPaper: propTexturePool.get(`${preset}:tex:stainedPaper`),
  }
}

function getPooledPropMaterial(key, spec, textures) {
  let mat = propMaterialPool.get(key)
  if (!mat) {
    mat = markSharedResource(
      new THREE.MeshStandardMaterial({
        color: spec.color,
        map: textures.map,
        roughnessMap: textures.roughnessMap,
        bumpMap: textures.bumpMap,
        bumpScale: spec.bumpScale,
        roughness: spec.roughness,
        metalness: spec.metalness,
        envMapIntensity: spec.envMapIntensity,
      })
    )
    propMaterialPool.set(key, mat)
  }
  return mat
}

/**
 * Returns a shared, pooled BufferGeometry for prop silhouettes so instances reuse
 * geometries across props and maze resets without disposal leaks.
 */
function getPooledPropGeometry(key, factory) {
  let geo = propGeometryPool.get(key)
  if (!geo) {
    geo = markSharedResource(factory())
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    propGeometryPool.set(key, geo)
  }
  return geo
}

/**
 * Returns the shared, calibrated MeshStandardMaterial dictionary for all environmental props.
 * Materials and textures are lazily pooled per quality preset and marked as shared resources so
 * `disposeMazeGroup()` never invalidates them between maze resets or retries.
 */
export function getEnvironmentalPropMaterials(options = {}) {
  const preset = resolveTextureQualityPreset(options?.qualityPreset)
  const texSet = getEnvironmentalPropTextureSet({ qualityPreset: preset })
  const archSurfaceSet = getMazeSurfaceTextureSet({ qualityPreset: preset })

  const debrisMat = getPooledPropMaterial(
    `${preset}:mat:debrisConcrete`,
    PROP_MATERIAL_PALETTE.debrisConcrete,
    archSurfaceSet.wall
  )
  if (
    debrisMat.map !== archSurfaceSet.wall.map ||
    debrisMat.roughnessMap !== archSurfaceSet.wall.roughnessMap ||
    debrisMat.bumpMap !== archSurfaceSet.wall.bumpMap
  ) {
    debrisMat.map = archSurfaceSet.wall.map
    debrisMat.roughnessMap = archSurfaceSet.wall.roughnessMap
    debrisMat.bumpMap = archSurfaceSet.wall.bumpMap
    debrisMat.needsUpdate = true
  }

  return {
    rustyMetal: getPooledPropMaterial(`${preset}:mat:rustyMetal`, PROP_MATERIAL_PALETTE.rustyMetal, texSet.rustMetal),
    darkSteel: getPooledPropMaterial(`${preset}:mat:darkSteel`, PROP_MATERIAL_PALETTE.darkSteel, texSet.steelGrime),
    weatheredWood: getPooledPropMaterial(`${preset}:mat:weatheredWood`, PROP_MATERIAL_PALETTE.weatheredWood, texSet.weatheredWood),
    cabinetGreen: getPooledPropMaterial(`${preset}:mat:cabinetGreen`, PROP_MATERIAL_PALETTE.cabinetGreen, texSet.agedPaint),
    lockerBlue: getPooledPropMaterial(`${preset}:mat:lockerBlue`, PROP_MATERIAL_PALETTE.lockerBlue, texSet.agedPaint),
    warningYellow: getPooledPropMaterial(`${preset}:mat:warningYellow`, PROP_MATERIAL_PALETTE.warningYellow, texSet.agedPaint),
    paperWhite: getPooledPropMaterial(`${preset}:mat:paperWhite`, PROP_MATERIAL_PALETTE.paperWhite, texSet.stainedPaper),
    debrisConcrete: debrisMat,
    cableBlack: getPooledPropMaterial(`${preset}:mat:cableBlack`, PROP_MATERIAL_PALETTE.cableBlack, texSet.steelGrime),
  }
}

export function disposeEnvironmentalPropPools() {
  propPrototypeCache.clear()

  for (const geo of propGeometryPool.values()) {
    geo?.dispose?.()
  }
  propGeometryPool.clear()

  for (const mat of propMaterialPool.values()) {
    mat?.dispose?.()
  }
  propMaterialPool.clear()

  for (const texBundle of propTexturePool.values()) {
    if (!texBundle) continue
    texBundle.map?.dispose?.()
    texBundle.roughnessMap?.dispose?.()
    texBundle.bumpMap?.dispose?.()
  }
  propTexturePool.clear()
}

export function getEnvironmentalPropPoolStats() {
  return {
    materials: propMaterialPool.size,
    textureSets: propTexturePool.size,
    geometries: propGeometryPool.size,
    prototypes: propPrototypeCache.size,
  }
}

registerSharedPoolClearer(disposeEnvironmentalPropPools)
registerTextureAnisotropySyncer((updateTex) => {
  for (const texBundle of propTexturePool.values()) {
    if (!texBundle) continue
    updateTex(texBundle.map)
    updateTex(texBundle.roughnessMap)
    updateTex(texBundle.bumpMap)
  }
})

// ---------------------------------------------------------------------------
// Reusable Geometry Assembly Helpers
// ---------------------------------------------------------------------------

const _partPos = new THREE.Vector3()
const _partEuler = new THREE.Euler()
const _partQuat = new THREE.Quaternion()
const _partScale = new THREE.Vector3()
const _partMat4 = new THREE.Matrix4()

function preparePartGeometry(srcGeo, opts = {}) {
  const geo = srcGeo.clone()
  srcGeo.dispose()
  if (!geo.attributes.normal) {
    geo.computeVertexNormals()
  }
  if (!geo.attributes.uv) {
    const count = geo.attributes.position.count
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
  }
  if (geo.attributes.tangent) {
    geo.deleteAttribute('tangent')
  }

  const {
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  } = opts

  if (x !== 0 || y !== 0 || z !== 0 || rx !== 0 || ry !== 0 || rz !== 0 || sx !== 1 || sy !== 1 || sz !== 1) {
    _partPos.set(x, y, z)
    _partEuler.set(rx, ry, rz, 'XYZ')
    _partQuat.setFromEuler(_partEuler)
    _partScale.set(sx, sy, sz)
    _partMat4.compose(_partPos, _partQuat, _partScale)
    geo.applyMatrix4(_partMat4)
  }

  return geo
}

function mergePartGeometries(partSpecs) {
  const prepared = partSpecs.map(([srcGeo, opts]) => preparePartGeometry(srcGeo, opts))
  const merged = mergeIndexedGeometries(prepared)
  for (let i = 0; i < prepared.length; i += 1) {
    prepared[i].dispose()
  }
  return merged
}

function createBoxPart(w, h, d, opts) {
  return [new THREE.BoxGeometry(w, h, d), opts]
}

function createCylPart(rTop, rBot, h, segs, opts) {
  return [new THREE.CylinderGeometry(rTop, rBot, h, segs), opts]
}

function createTorusPart(radius, tube, radialSegs, tubularSegs, opts) {
  return [new THREE.TorusGeometry(radius, tube, radialSegs, tubularSegs), opts]
}

/**
 * Generates an irregular faceted concrete rubble chunk whose bottom rests cleanly at y = 0.
 * Uses a displaced octagonal prism with beveled upper fracture planes, shared bottom cap
 * vertices, and an explicit index buffer with crisp planar normals.
 */
function createIrregularConcreteGeometry(seed, rx, ry, rz) {
  const sides = 8
  const baseRing = []
  const topRing = []

  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2 + (hash2i(i, 1, seed) - 0.5) * 0.28
    const radialScaleBot = 0.72 + hash2i(i, 2, seed) * 0.36
    const radialScaleTop = 0.42 + hash2i(i, 3, seed) * 0.42
    const topHeight = 0.62 + hash2i(i, 4, seed) * 0.38
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    baseRing.push([cos * rx * radialScaleBot, 0, sin * rz * radialScaleBot])
    topRing.push([cos * rx * radialScaleTop, ry * topHeight, sin * rz * radialScaleTop])
  }

  const centerBot = [0, 0, 0]
  const centerTop = [
    (hash2i(11, 5, seed) - 0.5) * rx * 0.25,
    ry * (0.94 + hash2i(12, 6, seed) * 0.12),
    (hash2i(13, 7, seed) - 0.5) * rz * 0.25,
  ]

  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  const pushVertex = (pt, nx, ny, nz) => {
    const idx = positions.length / 3
    positions.push(pt[0], pt[1], pt[2])
    normals.push(nx, ny, nz)
    uvs.push(pt[0] * 1.6 + 0.5, pt[2] * 1.6 + pt[1] * 1.1 + 0.5)
    return idx
  }

  // Planar bottom cap (-Y): shares center + ring vertices cleanly
  const botCenterIdx = pushVertex(centerBot, 0, -1, 0)
  const botRingIndices = []
  for (let i = 0; i < sides; i += 1) {
    botRingIndices.push(pushVertex(baseRing[i], 0, -1, 0))
  }
  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides
    indices.push(botCenterIdx, botRingIndices[i], botRingIndices[next])
  }

  const pushFlatTri = (a, b, c) => {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len

    const ia = pushVertex(a, nx, ny, nz)
    const ib = pushVertex(b, nx, ny, nz)
    const ic = pushVertex(c, nx, ny, nz)
    indices.push(ia, ib, ic)
  }

  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides
    // Top fractured cap (+Y)
    pushFlatTri(centerTop, topRing[next], topRing[i])
    // Side bevel quad split into two crisp triangles
    pushFlatTri(baseRing[i], topRing[i], topRing[next])
    pushFlatTri(baseRing[i], topRing[next], baseRing[next])
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeBoundingBox()
  return geo
}

/**
 * Generates a subtle creased/curled paper sheet whose lowest edge sits cleanly at y = 0.
 * Preserves indexed vertex sharing while keeping the curled corner silhouette.
 */
function createCreasedPaperGeometry(width, depth, thickness = 0.004, curlHeight = 0.008) {
  const geo = new THREE.BoxGeometry(width, thickness, depth, 3, 1, 2)

  const pos = geo.attributes.position
  const halfW = width * 0.5
  const halfD = depth * 0.5
  let minY = Infinity
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = x / halfW
    const nz = z / halfD
    const cornerCurl = Math.max(0, nx) * Math.max(0, nz) * curlHeight
    const foldWave = Math.sin(nx * Math.PI * 0.9) * (curlHeight * 0.25)
    const ny = y + cornerCurl + foldWave
    pos.setY(i, ny)
    if (ny < minY) minY = ny
  }
  geo.translate(0, -minY, 0)
  geo.computeVertexNormals()
  return geo
}

function makePropMesh(geo, material, name) {
  const mesh = new THREE.Mesh(geo, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// ---------------------------------------------------------------------------
// Phase 4 Detailed Silhouette Builders (all 12 PROP_TYPES)
// ---------------------------------------------------------------------------

function buildBrokenDesk(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-desk-broken'

  const topHalfHeight = 0.023
  const topTiltZ = 0.11
  const topTiltX = -0.04
  const topPivotY = 0.74

  // Beveled/framed tabletop slab (`desk-top`)
  const topGeo = getPooledPropGeometry('desk_broken:top', () =>
    mergePartGeometries([
      // Main slab (top face cleanly at localY = +0.023)
      createBoxPart(1.18, 0.046, 0.66, { y: 0 }),
      // Underside recessed edge apron lip so tabletop reads as framed & layered
      createBoxPart(1.12, 0.018, 0.6, { y: -0.03 }),
    ])
  )
  const topMesh = makePropMesh(topGeo, materials.weatheredWood, 'desk-top')
  topMesh.position.set(0, topPivotY, 0)
  topMesh.rotation.set(topTiltX, 0, topTiltZ, 'XYZ')
  topMesh.userData.topHalfHeight = topHalfHeight
  group.add(topMesh)

  // Steel apron rails, left under-desk drawer pedestal & snapped right-front leg stub (`desk-apron`)
  const apronGeo = getPooledPropGeometry('desk_broken:apron', () =>
    mergePartGeometries([
      // Rear modesty panel
      createBoxPart(1.02, 0.18, 0.018, { y: -0.115, z: -0.245 }),
      // Side & front apron rails
      createBoxPart(0.022, 0.055, 0.48, { x: -0.5, y: -0.055, z: 0 }),
      createBoxPart(0.022, 0.055, 0.48, { x: 0.5, y: -0.055, z: 0 }),
      createBoxPart(1.02, 0.045, 0.02, { y: -0.05, z: 0.245 }),
      // Left-side drawer pedestal carcass
      createBoxPart(0.32, 0.21, 0.48, { x: -0.32, y: -0.13, z: 0.005 }),
      // Pedestal drawer face & pull bar
      createBoxPart(0.28, 0.16, 0.018, { x: -0.32, y: -0.13, z: 0.252 }),
      createBoxPart(0.1, 0.014, 0.022, { x: -0.32, y: -0.125, z: 0.268 }),
      // Snapped right-front leg stub hanging from missing corner
      createBoxPart(0.036, 0.13, 0.036, { x: 0.495, y: -0.09, z: 0.245, rz: -0.22 }),
    ])
  )
  topMesh.add(makePropMesh(apronGeo, materials.darkSteel, 'desk-apron'))

  // 3 Standing tubular steel legs with foot pads grounded cleanly at y = 0 up into tilted underside
  const standingLegsGeo = getPooledPropGeometry('desk_broken:legs_standing', () => {
    const legCols = [
      { x: -0.51, z: -0.25, h: 0.665 }, // Back-left
      { x: 0.51, z: -0.25, h: 0.775 }, // Back-right
      { x: -0.51, z: 0.25, h: 0.685 }, // Front-left
    ]
    const parts = []
    for (const c of legCols) {
      parts.push(createBoxPart(0.038, c.h, 0.038, { x: c.x, y: c.h * 0.5, z: c.z }))
      parts.push(createBoxPart(0.066, 0.012, 0.066, { x: c.x, y: 0.006, z: c.z }))
    }
    return mergePartGeometries(parts)
  })
  group.add(makePropMesh(standingLegsGeo, materials.rustyMetal, 'desk-legs-standing'))

  // Detached broken 4th leg resting flat on the floor (`min.y === 0`)
  const brokenLegGeo = getPooledPropGeometry('desk_broken:leg_broken', () => {
    const merged = mergePartGeometries([
      createBoxPart(0.038, 0.54, 0.038, { y: 0 }),
      createBoxPart(0.066, 0.012, 0.066, { y: -0.264 }),
    ])
    merged.rotateX(Math.PI / 2)
    merged.rotateY(0.42)
    merged.computeBoundingBox()
    merged.translate(0.24, -merged.boundingBox.min.y, 0.06)
    return merged
  })
  group.add(makePropMesh(brokenLegGeo, materials.rustyMetal, 'desk-broken-leg'))

  // Scattered creased papers & folder resting flush on tilted tabletop (`localY = topHalfHeight`)
  const paperGeoA = getPooledPropGeometry('desk_broken:paper_a', () =>
    createCreasedPaperGeometry(0.26, 0.19, 0.005, 0.007)
  )
  const paper1 = makePropMesh(paperGeoA, materials.paperWhite, 'desk-paper')
  paper1.position.set(-0.22, topHalfHeight, 0.09)
  paper1.rotation.y = 0.34
  topMesh.add(paper1)

  const paperGeoB = getPooledPropGeometry('desk_broken:paper_b', () =>
    createCreasedPaperGeometry(0.23, 0.17, 0.005, 0.006)
  )
  const paper2 = makePropMesh(paperGeoB, materials.paperWhite, 'desk-paper')
  paper2.position.set(0.24, topHalfHeight, -0.08)
  paper2.rotation.y = -0.56
  topMesh.add(paper2)

  const folderGeo = getPooledPropGeometry('desk_broken:folder', () =>
    mergePartGeometries([
      createBoxPart(0.27, 0.008, 0.2, { y: 0.004 }),
      createBoxPart(0.25, 0.005, 0.18, { x: 0.015, y: 0.01, rz: 0.02, ry: 0.08 }),
    ])
  )
  const folder = makePropMesh(folderGeo, materials.cabinetGreen, 'desk-folder')
  folder.position.set(0.02, topHalfHeight, 0.01)
  folder.rotation.y = 0.14
  topMesh.add(folder)

  return group
}

function buildBrokenChair(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-chair-broken'

  // Contoured seat pad (`chair-seat`, strictly within halfWidth 0.36, halfDepth [-0.22..0.29])
  const seatGeo = getPooledPropGeometry('chair_broken:seat', () =>
    mergePartGeometries([
      createBoxPart(0.4, 0.032, 0.38, { y: 0.425, z: 0.01, rz: 0.07 }),
      // Front waterfall lip
      createBoxPart(0.4, 0.024, 0.036, { y: 0.417, z: 0.2, rx: 0.35, rz: 0.07 }),
    ])
  )
  group.add(makePropMesh(seatGeo, materials.weatheredWood, 'chair-seat'))

  // Dual wooden backrest slats (`chair-backrest`) - upper slat cracked/skewed
  const backGeo = getPooledPropGeometry('chair_broken:backrest', () =>
    mergePartGeometries([
      createBoxPart(0.36, 0.1, 0.026, { x: -0.01, y: 0.61, z: -0.175, rx: -0.08, rz: 0.03 }),
      createBoxPart(0.35, 0.105, 0.026, { x: -0.04, y: 0.78, z: -0.185, rx: -0.08, rz: -0.22 }),
    ])
  )
  group.add(makePropMesh(backGeo, materials.weatheredWood, 'chair-backrest'))

  // Tubular steel leg frame, cross-stretchers, under-seat rail & backrest uprights (`chair-legs`)
  const frameGeo = getPooledPropGeometry('chair_broken:frame', () => {
    const parts = [
      // Under-seat perimeter rails
      createBoxPart(0.36, 0.022, 0.022, { y: 0.4, z: -0.165, rz: 0.07 }),
      createBoxPart(0.36, 0.022, 0.022, { y: 0.4, z: 0.17, rz: 0.07 }),
      createBoxPart(0.022, 0.022, 0.35, { x: -0.175, y: 0.39, z: 0.005 }),
      createBoxPart(0.022, 0.022, 0.35, { x: 0.175, y: 0.415, z: 0.005 }),
      // 3 upright/intact steel legs reaching cleanly down to y = 0
      createCylPart(0.014, 0.012, 0.395, 6, { x: -0.175, y: 0.1975, z: -0.165 }),
      createCylPart(0.014, 0.012, 0.42, 6, { x: 0.175, y: 0.21, z: -0.165 }),
      createCylPart(0.014, 0.012, 0.395, 6, { x: -0.175, y: 0.1975, z: 0.17 }),
      // Stretcher bars
      createCylPart(0.009, 0.009, 0.35, 5, { x: 0, y: 0.15, z: -0.165, rz: Math.PI / 2 }),
      createCylPart(0.009, 0.009, 0.34, 5, { x: -0.175, y: 0.15, z: 0, rx: Math.PI / 2 }),
      // Vertical backrest uprights
      createCylPart(0.013, 0.013, 0.45, 6, { x: -0.16, y: 0.625, z: -0.172, rx: -0.08 }),
      createCylPart(0.013, 0.013, 0.43, 6, { x: 0.16, y: 0.62, z: -0.172, rx: -0.08, rz: -0.06 }),
    ]

    // Bent front-right leg computed to touch y = 0 cleanly without floor clipping
    const legLen = 0.41
    const legRad = 0.013
    const tiltX = 0.28
    const halfY = (legLen * 0.5) * Math.cos(tiltX) + legRad * Math.sin(tiltX)
    parts.push(createCylPart(0.014, 0.012, legLen, 6, { x: 0.175, y: halfY, z: 0.19, rx: tiltX }))

    return mergePartGeometries(parts)
  })
  group.add(makePropMesh(frameGeo, materials.rustyMetal, 'chair-legs'))

  return group
}

function buildOverturnedChair(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-chair-overturned'

  const seatGeo = getPooledPropGeometry('chair_overturned:seat', () =>
    mergePartGeometries([
      createBoxPart(0.39, 0.036, 0.38, { y: 0.36 }),
      createBoxPart(0.39, 0.025, 0.04, { y: 0.35, z: 0.195, rx: 0.32 }),
    ])
  )

  const backGeo = getPooledPropGeometry('chair_overturned:backrest', () =>
    mergePartGeometries([
      createBoxPart(0.37, 0.24, 0.034, { y: 0.66, z: -0.185, rx: -0.08 }),
    ])
  )

  const frameGeo = getPooledPropGeometry('chair_overturned:legs', () =>
    mergePartGeometries([
      createBoxPart(0.36, 0.02, 0.34, { y: 0.335 }),
      createCylPart(0.013, 0.011, 0.35, 6, { x: -0.17, y: 0.175, z: -0.16 }),
      createCylPart(0.013, 0.011, 0.35, 6, { x: 0.17, y: 0.175, z: -0.16 }),
      createCylPart(0.013, 0.011, 0.35, 6, { x: -0.17, y: 0.175, z: 0.16 }),
      createCylPart(0.013, 0.011, 0.33, 6, { x: 0.18, y: 0.185, z: 0.17, rz: -0.18 }),
      // Crossbars
      createCylPart(0.008, 0.008, 0.34, 5, { y: 0.13, z: -0.16, rz: Math.PI / 2 }),
      createCylPart(0.008, 0.008, 0.32, 5, { x: -0.17, y: 0.13, z: 0, rx: Math.PI / 2 }),
      // Backrest steel uprights
      createCylPart(0.012, 0.012, 0.38, 6, { x: -0.14, y: 0.54, z: -0.175, rx: -0.08 }),
      createCylPart(0.012, 0.012, 0.38, 6, { x: 0.14, y: 0.54, z: -0.175, rx: -0.08 }),
    ])
  )

  const bodyGroup = new THREE.Group()
  bodyGroup.add(makePropMesh(seatGeo, materials.darkSteel, 'chair-seat'))
  bodyGroup.add(makePropMesh(backGeo, materials.darkSteel, 'chair-backrest'))
  bodyGroup.add(makePropMesh(frameGeo, materials.rustyMetal, 'chair-legs'))

  bodyGroup.rotation.set(Math.PI * 0.44, Math.PI * 0.35, 0.16, 'XYZ')
  bodyGroup.updateMatrixWorld(true)

  const bounds = new THREE.Box3().setFromObject(bodyGroup)
  const maxHalfXZ = Math.max(
    (bounds.max.x - bounds.min.x) * 0.5,
    (bounds.max.z - bounds.min.z) * 0.5
  )
  // Keep strictly inside PROP_PLACEMENT_SPECS.CHAIR_OVERTURNED (0.31m half-extent)
  if (maxHalfXZ > 0.295) {
    const s = 0.295 / maxHalfXZ
    bodyGroup.scale.setScalar(s)
    bodyGroup.updateMatrixWorld(true)
    bounds.setFromObject(bodyGroup)
  }

  const center = bounds.getCenter(new THREE.Vector3())
  bodyGroup.position.set(-center.x, -bounds.min.y, -center.z)
  group.add(bodyGroup)

  return group
}

function buildFilingCabinet(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-filing-cabinet'

  // Framed cabinet outer shell (`cabinet-body`), centered slightly toward wall (-Z)
  // x in [-0.26, 0.26] <= 0.28, z in [-0.29, 0.25] (total with open drawer <= 0.44)
  const bodyGeo = getPooledPropGeometry('filing_cabinet:body', () =>
    mergePartGeometries([
      // Rear & side shell surrounding recessed front drawer bay
      createBoxPart(0.52, 1.28, 0.48, { y: 0.67, z: -0.05 }),
      // Top, bottom, and side front bezel rails
      createBoxPart(0.52, 0.04, 0.06, { y: 1.29, z: 0.22 }),
      createBoxPart(0.52, 0.04, 0.06, { y: 0.05, z: 0.22 }),
      createBoxPart(0.025, 1.28, 0.06, { x: -0.2475, y: 0.67, z: 0.22 }),
      createBoxPart(0.025, 1.28, 0.06, { x: 0.2475, y: 0.67, z: 0.22 }),
      // Top beveled steel cap
      createBoxPart(0.53, 0.022, 0.55, { y: 1.321, z: -0.015 }),
    ])
  )
  group.add(makePropMesh(bodyGeo, materials.cabinetGreen, 'cabinet-body'))

  // Dark steel plinth base + recessed shadow dividers between drawers + open top drawer tray
  const cavityGeo = getPooledPropGeometry('filing_cabinet:cavity_tray', () =>
    mergePartGeometries([
      // Plinth base grounded at y = 0
      createBoxPart(0.5, 0.032, 0.52, { y: 0.016, z: -0.02 }),
      // Dark divider shadows at front drawer seams
      createBoxPart(0.47, 0.014, 0.04, { y: 0.34, z: 0.215 }),
      createBoxPart(0.47, 0.014, 0.04, { y: 0.64, z: 0.215 }),
      createBoxPart(0.47, 0.014, 0.04, { y: 0.94, z: 0.215 }),
      // Open top drawer tray sidewalls & bottom (pulled out to z = 0.415)
      createBoxPart(0.43, 0.016, 0.22, { y: 1.0, z: 0.3 }),
      createBoxPart(0.016, 0.16, 0.22, { x: -0.21, y: 1.08, z: 0.3 }),
      createBoxPart(0.016, 0.16, 0.22, { x: 0.21, y: 1.08, z: 0.3 }),
    ])
  )
  group.add(makePropMesh(cavityGeo, materials.darkSteel, 'cabinet-drawer-open'))

  // 4 distinct drawer front plates (`cabinet-drawers`) — top drawer pulled open (`z = 0.415 < 0.45`)
  const drawersGeo = getPooledPropGeometry('filing_cabinet:drawers', () =>
    mergePartGeometries([
      createBoxPart(0.455, 0.26, 0.024, { y: 0.19, z: 0.245 }),
      createBoxPart(0.455, 0.26, 0.024, { y: 0.49, z: 0.248, rz: 0.022 }),
      createBoxPart(0.455, 0.26, 0.024, { y: 0.79, z: 0.245 }),
      // Top drawer face pulled out cleanly
      createBoxPart(0.455, 0.26, 0.026, { y: 1.1, z: 0.415 }),
    ])
  )
  group.add(makePropMesh(drawersGeo, materials.cabinetGreen, 'cabinet-drawers'))

  // Drawer handles & label frames (`cabinet-handles`)
  const handlesGeo = getPooledPropGeometry('filing_cabinet:handles', () => {
    const drawerCenters = [
      { y: 0.19, z: 0.258 },
      { y: 0.49, z: 0.261 },
      { y: 0.79, z: 0.258 },
      { y: 1.1, z: 0.429 },
    ]
    const parts = []
    for (const d of drawerCenters) {
      // Bar handle
      parts.push(createBoxPart(0.11, 0.018, 0.018, { y: d.y + 0.01, z: d.z + 0.008 }))
      // Label holder bezel above handle
      parts.push(createBoxPart(0.085, 0.042, 0.008, { y: d.y + 0.065, z: d.z + 0.004 }))
    }
    return mergePartGeometries(parts)
  })
  group.add(makePropMesh(handlesGeo, materials.rustyMetal, 'cabinet-handles'))

  // Stacked folders & loose files visible inside open top drawer (`cabinet-papers`)
  const papersGeo = getPooledPropGeometry('filing_cabinet:papers', () =>
    mergePartGeometries([
      createBoxPart(0.34, 0.18, 0.012, { x: -0.02, y: 1.11, z: 0.36, rx: 0.16, rz: 0.04 }),
      createBoxPart(0.32, 0.19, 0.012, { x: 0.02, y: 1.12, z: 0.32, rx: 0.22, rz: -0.06 }),
      createBoxPart(0.3, 0.17, 0.012, { x: -0.01, y: 1.1, z: 0.28, rx: 0.12 }),
    ])
  )
  group.add(makePropMesh(papersGeo, materials.paperWhite, 'cabinet-papers'))

  return group
}

function buildFilingCabinetOverturned(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-filing-cabinet-overturned'

  const bodyGroup = new THREE.Group()

  const shellGeo = getPooledPropGeometry('filing_cabinet_overturned:shell', () =>
    mergePartGeometries([
      createBoxPart(0.5, 1.2, 0.46, { y: 0.62, z: -0.04 }),
      createBoxPart(0.5, 0.04, 0.06, { y: 1.2, z: 0.22 }),
      createBoxPart(0.5, 0.04, 0.06, { y: 0.04, z: 0.22 }),
      createBoxPart(0.025, 1.2, 0.06, { x: -0.2375, y: 0.62, z: 0.22 }),
      createBoxPart(0.025, 1.2, 0.06, { x: 0.2375, y: 0.62, z: 0.22 }),
    ])
  )

  const drawerFacesGeo = getPooledPropGeometry('filing_cabinet_overturned:drawers', () =>
    mergePartGeometries([
      createBoxPart(0.435, 0.24, 0.022, { y: 0.18, z: 0.24 }),
      createBoxPart(0.435, 0.24, 0.022, { y: 0.46, z: 0.24 }),
      createBoxPart(0.435, 0.24, 0.022, { y: 0.74, z: 0.255, rx: 0.05 }),
      // Ajar top drawer
      createBoxPart(0.435, 0.24, 0.024, { y: 1.03, z: 0.34, rx: 0.08 }),
    ])
  )

  const hardwareGeo = getPooledPropGeometry('filing_cabinet_overturned:handles', () =>
    mergePartGeometries([
      // Drawer handles
      createBoxPart(0.1, 0.016, 0.016, { y: 0.19, z: 0.258 }),
      createBoxPart(0.1, 0.016, 0.016, { y: 0.47, z: 0.258 }),
      createBoxPart(0.1, 0.016, 0.016, { y: 0.75, z: 0.273 }),
      createBoxPart(0.1, 0.016, 0.016, { y: 1.04, z: 0.358 }),
      // Open drawer side walls
      createBoxPart(0.41, 0.016, 0.14, { y: 0.94, z: 0.26 }),
      createBoxPart(0.016, 0.14, 0.14, { x: -0.2, y: 1.01, z: 0.26 }),
      createBoxPart(0.016, 0.14, 0.14, { x: 0.2, y: 1.01, z: 0.26 }),
    ])
  )

  const drawerPapersGeo = getPooledPropGeometry('filing_cabinet_overturned:papers', () =>
    mergePartGeometries([
      createBoxPart(0.32, 0.16, 0.012, { y: 1.03, z: 0.29, rx: 0.2 }),
      createBoxPart(0.28, 0.15, 0.012, { x: 0.04, y: 1.04, z: 0.25, rx: 0.28 }),
    ])
  )

  bodyGroup.add(makePropMesh(shellGeo, materials.cabinetGreen, 'cabinet-body'))
  bodyGroup.add(makePropMesh(drawerFacesGeo, materials.cabinetGreen, 'cabinet-drawers'))
  bodyGroup.add(makePropMesh(hardwareGeo, materials.rustyMetal, 'cabinet-handles'))
  bodyGroup.add(makePropMesh(drawerPapersGeo, materials.paperWhite, 'cabinet-papers'))

  bodyGroup.rotation.set(0, 0.22, Math.PI / 2, 'XYZ')
  bodyGroup.updateMatrixWorld(true)

  const bounds = new THREE.Box3().setFromObject(bodyGroup)
  const center = bounds.getCenter(new THREE.Vector3())
  bodyGroup.position.set(-center.x, -bounds.min.y, -center.z)
  group.add(bodyGroup)

  // Loose paper spilled on floor right beside the ajar drawer (strictly within +/-0.70, +/-0.47)
  const floorPaperGeo = getPooledPropGeometry('filing_cabinet_overturned:floor_paper', () =>
    createCreasedPaperGeometry(0.24, 0.18, 0.005, 0.007)
  )
  const spilledPaper = makePropMesh(floorPaperGeo, materials.paperWhite, 'cabinet-spilled-paper')
  spilledPaper.position.set(-0.48, 0, 0.28)
  spilledPaper.rotation.y = 0.65
  group.add(spilledPaper)

  return group
}

function buildStorageLocker(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-storage-locker'

  // Twin-bay open-front locker carcass (`locker-frame`):
  // Width 0.80 (x in [-0.40, 0.40]), depth 0.44 (z in [-0.27, 0.17])
  const frameGeo = getPooledPropGeometry('storage_locker:frame', () =>
    mergePartGeometries([
      // Plinth base grounded at y = 0
      createBoxPart(0.8, 0.07, 0.44, { y: 0.035, z: -0.05 }),
      // Top cap
      createBoxPart(0.8, 0.04, 0.44, { y: 1.78, z: -0.05 }),
      // Back wall
      createBoxPart(0.8, 1.69, 0.025, { y: 0.915, z: -0.2575 }),
      // Left & right side walls
      createBoxPart(0.026, 1.69, 0.44, { x: -0.387, y: 0.915, z: -0.05 }),
      createBoxPart(0.026, 1.69, 0.44, { x: 0.387, y: 0.915, z: -0.05 }),
      // Center vertical bay partition
      createBoxPart(0.024, 1.69, 0.41, { x: 0, y: 0.915, z: -0.045 }),
      // Interior shelves inside exposed right bay
      createBoxPart(0.36, 0.022, 0.39, { x: 0.195, y: 0.58, z: -0.045 }),
      createBoxPart(0.36, 0.022, 0.39, { x: 0.195, y: 1.32, z: -0.045 }),
    ])
  )
  group.add(makePropMesh(frameGeo, materials.lockerBlue, 'locker-frame'))

  // Left door (closed / slightly unlatched) + right door (swung ajar ~47 deg within z <= 0.44)
  // Door width = 0.37, hinge at x = +0.385, z = 0.175 -> tip at (0.133, 0.445) < 0.48
  const rightDoorAngle = -0.82
  const doorW = 0.37
  const doorCenterOffset = -doorW * 0.5
  const rightDoorX = 0.385 + Math.cos(rightDoorAngle) * doorCenterOffset
  const rightDoorZ = 0.175 - Math.sin(rightDoorAngle) * doorCenterOffset

  const doorsGeo = getPooledPropGeometry('storage_locker:doors', () =>
    mergePartGeometries([
      // Left door slightly unlatched
      createBoxPart(0.37, 1.65, 0.024, { x: -0.195, y: 0.91, z: 0.172, ry: 0.05 }),
      // Right door swung open revealing interior compartment & shelves
      createBoxPart(doorW, 1.65, 0.024, {
        x: rightDoorX,
        y: 0.91,
        z: rightDoorZ,
        ry: rightDoorAngle,
      }),
    ])
  )
  group.add(makePropMesh(doorsGeo, materials.lockerBlue, 'locker-doors'))

  // Louver vents, hinge knuckles, and recessed latch handles (`locker-hardware`)
  const hardwareGeo = getPooledPropGeometry('storage_locker:hardware', () => {
    const parts = [
      // Left door louvers (top & bottom) + handle
      createBoxPart(0.22, 0.016, 0.012, { x: -0.195, y: 1.56, z: 0.186, ry: 0.05 }),
      createBoxPart(0.22, 0.016, 0.012, { x: -0.195, y: 1.51, z: 0.186, ry: 0.05 }),
      createBoxPart(0.22, 0.016, 0.012, { x: -0.195, y: 0.25, z: 0.186, ry: 0.05 }),
      createBoxPart(0.024, 0.11, 0.02, { x: -0.05, y: 0.95, z: 0.188, ry: 0.05 }),
      // Right door louvers + latch handle attached in door frame
      createBoxPart(0.2, 0.016, 0.014, { x: rightDoorX, y: 1.56, z: rightDoorZ, ry: rightDoorAngle }),
      createBoxPart(0.2, 0.016, 0.014, { x: rightDoorX, y: 1.51, z: rightDoorZ, ry: rightDoorAngle }),
      createBoxPart(0.2, 0.016, 0.014, { x: rightDoorX, y: 0.25, z: rightDoorZ, ry: rightDoorAngle }),
      // Right door hinge knuckles
      createCylPart(0.01, 0.01, 0.055, 5, { x: 0.39, y: 1.48, z: 0.18 }),
      createCylPart(0.01, 0.01, 0.055, 5, { x: 0.39, y: 0.36, z: 0.18 }),
    ]
    return mergePartGeometries(parts)
  })
  group.add(makePropMesh(hardwareGeo, materials.rustyMetal, 'locker-hardware'))

  // Restrained interior shelf items inside open right bay (`locker-contents`)
  const contentsGeo = getPooledPropGeometry('storage_locker:contents', () =>
    mergePartGeometries([
      // Small rusted storage tin on middle shelf (y = 0.591)
      createBoxPart(0.2, 0.11, 0.18, { x: 0.19, y: 0.646, z: -0.04, ry: 0.2 }),
    ])
  )
  group.add(makePropMesh(contentsGeo, materials.warningYellow, 'locker-contents'))

  return group
}

function buildStorageShelf(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-storage-shelf'

  // Open 4-post industrial slotted steel rack (`shelf-frame`), footprint +/-0.45 x +/-0.21
  const frameGeo = getPooledPropGeometry('storage_shelf:frame', () => {
    const postX = [-0.43, 0.43]
    const postZ = [-0.19, 0.19]
    const parts = []
    for (const px of postX) {
      for (const pz of postZ) {
        parts.push(createBoxPart(0.036, 1.72, 0.036, { x: px, y: 0.86, z: pz }))
        parts.push(createBoxPart(0.058, 0.012, 0.058, { x: px, y: 0.006, z: pz }))
      }
    }
    // Rear diagonal cross-braces
    parts.push(createBoxPart(0.018, 1.56, 0.012, { x: 0, y: 0.88, z: -0.2, rz: 0.52 }))
    parts.push(createBoxPart(0.018, 1.56, 0.012, { x: 0, y: 0.88, z: -0.2, rz: -0.52 }))
    // Side tie rails
    parts.push(createBoxPart(0.014, 0.028, 0.38, { x: -0.435, y: 0.9, z: 0 }))
    parts.push(createBoxPart(0.014, 0.028, 0.38, { x: 0.435, y: 0.9, z: 0 }))
    return mergePartGeometries(parts)
  })
  group.add(makePropMesh(frameGeo, materials.rustyMetal, 'shelf-frame'))

  // 4 Open horizontal shelf trays (`shelf-tiers`)
  const tiersGeo = getPooledPropGeometry('storage_shelf:tiers', () => {
    const heights = [0.12, 0.62, 1.14, 1.66]
    const parts = []
    for (const h of heights) {
      parts.push(createBoxPart(0.88, 0.03, 0.4, { y: h }))
    }
    return mergePartGeometries(parts)
  })
  group.add(makePropMesh(tiersGeo, materials.darkSteel, 'shelf-tiers'))

  // Restrained shelf cargo resting flush on tier tops (0.635 and 1.155)
  const crateCargoGeo = getPooledPropGeometry('storage_shelf:cargo_crate', () =>
    mergePartGeometries([
      // Small slatted wood crate on tier 2 (top = 0.635)
      createBoxPart(0.32, 0.24, 0.3, { x: -0.2, y: 0.755, z: 0, ry: 0.08 }),
      createBoxPart(0.34, 0.04, 0.32, { x: -0.2, y: 0.855, z: 0, ry: 0.08 }),
    ])
  )
  group.add(makePropMesh(crateCargoGeo, materials.weatheredWood, 'shelf-cargo-crate'))

  const tinCargoGeo = getPooledPropGeometry('storage_shelf:cargo_tin', () =>
    mergePartGeometries([
      // Battered industrial tin/toolbox on tier 3 (top = 1.155)
      createBoxPart(0.28, 0.16, 0.22, { x: 0.16, y: 1.235, z: 0.01, ry: -0.18 }),
      // Canister on bottom tier (top = 0.135)
      createCylPart(0.085, 0.085, 0.26, 10, { x: 0.22, y: 0.265, z: -0.02 }),
    ])
  )
  group.add(makePropMesh(tinCargoGeo, materials.warningYellow, 'shelf-cargo-container'))

  const shelfPapersGeo = getPooledPropGeometry('storage_shelf:cargo_papers', () =>
    mergePartGeometries([
      createBoxPart(0.22, 0.026, 0.18, { x: -0.18, y: 1.168, z: 0.02, ry: 0.26 }),
    ])
  )
  group.add(makePropMesh(shelfPapersGeo, materials.paperWhite, 'shelf-cargo-papers'))

  return group
}

function buildIndustrialBarrel(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-industrial-barrel'

  // 55-gallon ribbed steel drum body (`barrel-body`), radius 0.315 <= 0.35
  const bodyGeo = getPooledPropGeometry('industrial_barrel:body', () =>
    mergePartGeometries([
      createCylPart(0.312, 0.308, 0.86, 12, { y: 0.45 }),
      // Slightly recessed top lid panel
      createCylPart(0.292, 0.292, 0.02, 12, { y: 0.875 }),
    ])
  )
  group.add(makePropMesh(bodyGeo, materials.warningYellow, 'barrel-body'))

  // Chime rims, dual rolled stiffening hoops & top bung plugs (`barrel-hoops`)
  const hoopsGeo = getPooledPropGeometry('industrial_barrel:hoops', () =>
    mergePartGeometries([
      // Bottom chime ring grounded flush at y = 0 (tube * sin(60deg) = 0.01386)
      createTorusPart(0.308, 0.016, 6, 12, { y: 0.0139, rx: Math.PI / 2 }),
      // Top chime rim
      createTorusPart(0.312, 0.016, 6, 12, { y: 0.884, rx: Math.PI / 2 }),
      // Two rolled waist stiffening ribs (outer radius 0.333 <= 0.35)
      createTorusPart(0.316, 0.016, 6, 12, { y: 0.31, rx: Math.PI / 2 }),
      createTorusPart(0.316, 0.016, 6, 12, { y: 0.6, rx: Math.PI / 2 }),
      // Bung plugs on recessed top lid
      createCylPart(0.026, 0.026, 0.022, 6, { x: 0.14, y: 0.892, z: 0.06 }),
      createCylPart(0.017, 0.017, 0.02, 6, { x: -0.15, y: 0.891, z: -0.05 }),
    ])
  )
  group.add(makePropMesh(hoopsGeo, materials.rustyMetal, 'barrel-hoops'))

  return group
}

function buildWoodenCrate(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-wooden-crate'

  // Recessed inner crate plank body (`crate-core`)
  const coreGeo = getPooledPropGeometry('wooden_crate:core', () =>
    mergePartGeometries([createBoxPart(0.5, 0.5, 0.5, { y: 0.27 })])
  )
  group.add(makePropMesh(coreGeo, materials.weatheredWood, 'crate-core'))

  // Outer slatted perimeter framing battens & diagonal cross-braces (`crate-slats`)
  // Max extent +/-0.275 <= 0.29, min.y = 0
  const slatsGeo = getPooledPropGeometry('wooden_crate:slats', () => {
    const parts = []
    // 4 heavy corner posts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(createBoxPart(0.056, 0.56, 0.056, { x: sx * 0.246, y: 0.28, z: sz * 0.246 }))
      }
    }
    // Top & bottom perimeter horizontal battens
    for (const hy of [0.028, 0.532]) {
      parts.push(createBoxPart(0.54, 0.056, 0.026, { y: hy, z: 0.261 }))
      parts.push(createBoxPart(0.54, 0.056, 0.026, { y: hy, z: -0.261 }))
      parts.push(createBoxPart(0.026, 0.056, 0.54, { x: 0.261, y: hy }))
      parts.push(createBoxPart(0.026, 0.056, 0.54, { x: -0.261, y: hy }))
    }
    // Diagonal brace slats on front/back & left/right
    parts.push(createBoxPart(0.044, 0.62, 0.022, { y: 0.28, z: 0.258, rz: 0.78 }))
    parts.push(createBoxPart(0.044, 0.62, 0.022, { y: 0.28, z: -0.258, rz: -0.78 }))
    parts.push(createBoxPart(0.022, 0.62, 0.044, { x: 0.258, y: 0.28, rx: 0.78 }))
    parts.push(createBoxPart(0.022, 0.62, 0.044, { x: -0.258, y: 0.28, rx: -0.78 }))
    // Top lid rim slats
    parts.push(createBoxPart(0.52, 0.026, 0.08, { y: 0.547, z: 0.14 }))
    parts.push(createBoxPart(0.52, 0.026, 0.08, { y: 0.547, z: -0.14 }))
    return mergePartGeometries(parts)
  })
  group.add(makePropMesh(slatsGeo, materials.weatheredWood, 'crate-slats'))

  // Rusted steel corner reinforcement straps (`crate-brackets`)
  const bracketsGeo = getPooledPropGeometry('wooden_crate:brackets', () => {
    const parts = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(createBoxPart(0.068, 0.044, 0.068, { x: sx * 0.244, y: 0.538, z: sz * 0.244 }))
      }
    }
    return mergePartGeometries(parts)
  })
  group.add(makePropMesh(bracketsGeo, materials.rustyMetal, 'crate-brackets'))

  return group
}

function buildToolbox(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-toolbox'

  // Stepped steel lower tray (`toolbox-body`), footprint +/-0.21 x +/-0.12
  const bodyGeo = getPooledPropGeometry('toolbox:body', () =>
    mergePartGeometries([
      createBoxPart(0.42, 0.135, 0.24, { y: 0.0675 }),
      // Upper rolled tray lip
      createBoxPart(0.435, 0.018, 0.254, { y: 0.138 }),
    ])
  )
  group.add(makePropMesh(bodyGeo, materials.warningYellow, 'toolbox-body'))

  // Hipped/cantilevered top lid (`toolbox-lid`)
  const lidGeo = getPooledPropGeometry('toolbox:lid', () =>
    mergePartGeometries([
      createBoxPart(0.43, 0.055, 0.25, { y: 0.175 }),
      createBoxPart(0.36, 0.036, 0.17, { y: 0.22 }),
    ])
  )
  group.add(makePropMesh(lidGeo, materials.darkSteel, 'toolbox-lid'))

  // Front clasp latches & rear hinge spine (`toolbox-latches`)
  const latchesGeo = getPooledPropGeometry('toolbox:latches', () =>
    mergePartGeometries([
      createBoxPart(0.028, 0.052, 0.016, { x: -0.115, y: 0.145, z: 0.128 }),
      createBoxPart(0.028, 0.052, 0.016, { x: 0.115, y: 0.145, z: 0.128 }),
      createBoxPart(0.32, 0.018, 0.014, { y: 0.146, z: -0.126 }),
    ])
  )
  group.add(makePropMesh(latchesGeo, materials.rustyMetal, 'toolbox-latches'))

  // Top U-shaped steel carry handle (`toolbox-handle`)
  const handleGeo = getPooledPropGeometry('toolbox:handle', () =>
    mergePartGeometries([
      createBoxPart(0.018, 0.048, 0.022, { x: -0.095, y: 0.26 }),
      createBoxPart(0.018, 0.048, 0.022, { x: 0.095, y: 0.26 }),
      createCylPart(0.013, 0.013, 0.21, 6, { y: 0.285, rz: Math.PI / 2 }),
    ])
  )
  group.add(makePropMesh(handleGeo, materials.darkSteel, 'toolbox-handle'))

  return group
}

function buildElectricalPanel(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-electrical-panel'

  // NEMA wall-mounted cabinet enclosure (`panel-enclosure`), back face strictly at z = -0.10
  // Vertical elevation stays inside min.y [0.35..0.55], max.y [1.40..1.75]
  const enclosureGeo = getPooledPropGeometry('electrical_panel:enclosure', () =>
    mergePartGeometries([
      // Wall-mounting flange plate (back face flush at z = -0.10)
      createBoxPart(0.51, 0.68, 0.016, { y: 1.25, z: -0.092 }),
      // Main enclosure body (z from -0.10 to +0.048)
      createBoxPart(0.45, 0.63, 0.148, { y: 1.25, z: -0.026 }),
      // Top conduit collar & vertical riser pipe up to y = 1.635 (stays <= 1.75m at scaleMax=1.05)
      createCylPart(0.036, 0.04, 0.028, 8, { x: -0.09, y: 1.575, z: -0.03 }),
      createCylPart(0.022, 0.022, 0.08, 8, { x: -0.09, y: 1.6, z: -0.03 }),
    ])
  )
  group.add(makePropMesh(enclosureGeo, materials.darkSteel, 'panel-enclosure'))

  // Hinged front access door (`panel-door`)
  const doorGeo = getPooledPropGeometry('electrical_panel:door', () =>
    mergePartGeometries([
      createBoxPart(0.41, 0.57, 0.022, { y: 1.25, z: 0.058 }),
      // Embossed panel border frame
      createBoxPart(0.36, 0.51, 0.008, { y: 1.25, z: 0.07 }),
    ])
  )
  group.add(makePropMesh(doorGeo, materials.lockerBlue, 'panel-door'))

  // Hinge knuckles, rotary disconnect lever, breaker bezel & bottom cable glands (`panel-hardware`)
  const hardwareGeo = getPooledPropGeometry('electrical_panel:hardware', () =>
    mergePartGeometries([
      // 2 cylindrical hinge knuckles on left door edge
      createCylPart(0.011, 0.011, 0.055, 6, { x: -0.205, y: 1.44, z: 0.062 }),
      createCylPart(0.011, 0.011, 0.055, 6, { x: -0.205, y: 1.06, z: 0.062 }),
      // Rotary isolator switch plate & handle on right side
      createBoxPart(0.065, 0.085, 0.012, { x: 0.13, y: 1.32, z: 0.076 }),
      createBoxPart(0.02, 0.055, 0.016, { x: 0.13, y: 1.33, z: 0.084, rz: -0.35 }),
      // Latch clasp
      createBoxPart(0.022, 0.05, 0.014, { x: 0.175, y: 1.18, z: 0.076 }),
      // Dual bottom gland collars for hanging cables
      createCylPart(0.024, 0.028, 0.028, 6, { x: 0.08, y: 0.922, z: -0.025 }),
      createCylPart(0.02, 0.024, 0.026, 6, { x: -0.11, y: 0.923, z: -0.03 }),
    ])
  )
  group.add(makePropMesh(hardwareGeo, materials.rustyMetal, 'panel-hardware'))

  // Faded weathered warning plaque on door (`panel-warning`)
  const warningGeo = getPooledPropGeometry('electrical_panel:warning', () =>
    mergePartGeometries([
      createBoxPart(0.115, 0.075, 0.008, { x: -0.03, y: 1.38, z: 0.076 }),
    ])
  )
  group.add(makePropMesh(warningGeo, materials.warningYellow, 'panel-warning'))

  // Dual curved matte rubber cables hanging from bottom glands (y min ~ 0.44, z in [-0.08..+0.04])
  const cablesGeo = getPooledPropGeometry('electrical_panel:cables', () => {
    const curveA = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.08, 0.915, -0.02),
      new THREE.Vector3(0.11, 0.76, 0.01),
      new THREE.Vector3(0.15, 0.58, -0.02),
      new THREE.Vector3(0.09, 0.45, -0.05),
    ])
    const curveB = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.11, 0.915, -0.025),
      new THREE.Vector3(-0.14, 0.77, 0.005),
      new THREE.Vector3(-0.1, 0.62, -0.03),
      new THREE.Vector3(-0.15, 0.49, -0.06),
    ])
    return mergePartGeometries([
      [new THREE.TubeGeometry(curveA, 8, 0.016, 5, false), {}],
      [new THREE.TubeGeometry(curveB, 7, 0.012, 5, false), {}],
    ])
  })
  group.add(makePropMesh(cablesGeo, materials.cableBlack, 'panel-cables'))

  return group
}

function buildDebrisPile(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-debris-pile'

  // Faceted irregular concrete rubble chunks (`debris-chunks`), min.y === 0, bounds inside +/-0.42 x [-0.33..0.28]
  const chunksGeo = getPooledPropGeometry('debris_pile:chunks', () =>
    mergePartGeometries([
      [createIrregularConcreteGeometry(7103, 0.19, 0.18, 0.16), { x: -0.03, y: 0, z: -0.02, ry: 0.4 }],
      [createIrregularConcreteGeometry(7211, 0.15, 0.12, 0.14), { x: 0.21, y: 0, z: -0.13, ry: -0.65 }],
      [createIrregularConcreteGeometry(7307, 0.12, 0.09, 0.11), { x: -0.2, y: 0, z: -0.15, ry: 1.1 }],
    ])
  )
  group.add(makePropMesh(chunksGeo, materials.debrisConcrete, 'debris-chunks'))

  // Short bent rusted rebar / scrap angle resting against main rubble (`debris-rebar`)
  const rebarGeo = getPooledPropGeometry('debris_pile:rebar', () => {
    const merged = mergePartGeometries([
      createCylPart(0.012, 0.012, 0.34, 6, { x: 0.06, y: 0.09, z: 0.06, rx: 1.05, rz: -0.52 }),
      createCylPart(0.011, 0.011, 0.14, 6, { x: 0.15, y: 0.16, z: 0.01, rx: 0.35, rz: -1.1 }),
    ])
    merged.computeBoundingBox()
    if (merged.boundingBox.min.y < 0.005) {
      merged.translate(0, 0.005 - merged.boundingBox.min.y, 0)
    }
    return merged
  })
  group.add(makePropMesh(rebarGeo, materials.rustyMetal, 'debris-rebar'))

  // Subtle coiled matte rubber cable snippet resting on floor (`debris-cable`)
  const cableGeo = getPooledPropGeometry('debris_pile:cable', () => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.34, 0.013, 0.04),
      new THREE.Vector3(-0.22, 0.013, 0.16),
      new THREE.Vector3(-0.04, 0.013, 0.19),
      new THREE.Vector3(0.14, 0.013, 0.13),
    ])
    const tube = new THREE.TubeGeometry(curve, 8, 0.012, 5, false)
    tube.computeBoundingBox()
    if (tube.boundingBox.min.y < 0.001) {
      tube.translate(0, 0.001 - tube.boundingBox.min.y, 0)
    }
    return tube
  })
  group.add(makePropMesh(cableGeo, materials.cableBlack, 'debris-cable'))

  // Loose creased papers lying along floor edge (`debris-papers`)
  const papersGeo = getPooledPropGeometry('debris_pile:papers', () =>
    mergePartGeometries([
      [createCreasedPaperGeometry(0.22, 0.16, 0.004, 0.006), { x: -0.24, y: 0.001, z: 0.14, ry: 0.85 }],
      [createCreasedPaperGeometry(0.18, 0.14, 0.004, 0.005), { x: 0.25, y: 0.001, z: 0.11, ry: -0.45 }],
    ])
  )
  group.add(makePropMesh(papersGeo, materials.paperWhite, 'debris-papers'))

  return group
}

const PROP_BUILDERS = {
  [PROP_TYPES.DESK_BROKEN]: buildBrokenDesk,
  [PROP_TYPES.CHAIR_BROKEN]: buildBrokenChair,
  [PROP_TYPES.CHAIR_OVERTURNED]: buildOverturnedChair,
  [PROP_TYPES.FILING_CABINET]: buildFilingCabinet,
  [PROP_TYPES.FILING_CABINET_OVERTURNED]: buildFilingCabinetOverturned,
  [PROP_TYPES.STORAGE_LOCKER]: buildStorageLocker,
  [PROP_TYPES.STORAGE_SHELF]: buildStorageShelf,
  [PROP_TYPES.INDUSTRIAL_BARREL]: buildIndustrialBarrel,
  [PROP_TYPES.WOODEN_CRATE]: buildWoodenCrate,
  [PROP_TYPES.TOOLBOX]: buildToolbox,
  [PROP_TYPES.ELECTRICAL_PANEL]: buildElectricalPanel,
  [PROP_TYPES.DEBRIS_PILE]: buildDebrisPile,
}

/**
 * Builds an unscaled local-space environmental prop prototype for the given PROP_TYPES value.
 */
export function createEnvironmentalPropMesh(propType, materials = getEnvironmentalPropMaterials()) {
  const builder = PROP_BUILDERS[propType] || buildDebrisPile
  return builder(materials)
}

const _instPos = new THREE.Vector3()
const _instQuat = new THREE.Quaternion()
const _instScale = new THREE.Vector3()
const _instYAxis = new THREE.Vector3(0, 1, 0)
const _instPropMatrix = new THREE.Matrix4()

/**
 * Extracts and caches local-space leaf part descriptors for `propType` so
 * `buildEnvironmentalProps` can batch all placed instances via `THREE.InstancedMesh`
 * without allocating per-prop `Group`/`Mesh` scene-graph wrappers.
 */
function getPropPrototypeParts(propType, materials) {
  let cached = propPrototypeCache.get(propType)
  if (cached) {
    return cached
  }

  const matToKey = new Map()
  const entries = Object.entries(materials)
  for (let i = 0; i < entries.length; i += 1) {
    matToKey.set(entries[i][1], entries[i][0])
  }

  const proto = createEnvironmentalPropMesh(propType, materials)
  proto.updateMatrixWorld(true)

  cached = []
  proto.traverse((node) => {
    if (!node.isMesh) return
    cached.push({
      name: node.name || propType,
      geometry: node.geometry,
      materialKey: matToKey.get(node.material) || 'darkSteel',
      localMatrix: node.matrixWorld.clone(),
    })
  })
  proto.clear()
  propPrototypeCache.set(propType, cached)
  return cached
}

/**
 * Builds and returns a THREE.Group containing instanced procedural environmental props.
 * Batches identical pooled `(geometry, material)` pairs across all placed props into
 * `THREE.InstancedMesh` draw calls while preserving full Phase 1-4 fidelity.
 */
export function buildEnvironmentalProps(maze, options = {}) {
  const propList = Array.isArray(options.placedProps)
    ? options.placedProps
    : placeEnvironmentalProps(maze, options)
  if (!propList || propList.length === 0) {
    return null
  }

  const materials = getEnvironmentalPropMaterials({ qualityPreset: options.qualityPreset })
  const rootGroup = new THREE.Group()
  rootGroup.name = 'maze-environmental-props'

  const propChunkLayout = createMazeChunkLayout(maze, { maxChunksPerAxis: 2 })
  const bucketsByGeometry = new Map()
  const placedMeta = []
  let builtCount = 0
  let totalSubInstances = 0

  for (let i = 0; i < propList.length; i += 1) {
    const desc = propList[i]
    const worldPos = gridToWorld(desc.row, desc.col, maze)
    if (!worldPos) continue

    const px = worldPos.x + (desc.offsetX || 0)
    const pz = worldPos.z + (desc.offsetZ || 0)
    const yaw = desc.rotationYaw || 0
    const scale = desc.scale && desc.scale > 0 ? desc.scale : 1
    const chunkIdx = propChunkLayout.getChunkIndex(px, pz)

    _instPos.set(px, 0, pz)
    _instQuat.setFromAxisAngle(_instYAxis, yaw)
    _instScale.set(scale, scale, scale)
    _instPropMatrix.compose(_instPos, _instQuat, _instScale)

    const parts = getPropPrototypeParts(desc.type, materials)
    for (let p = 0; p < parts.length; p += 1) {
      const part = parts[p]
      const matKey = materials[part.materialKey] ? part.materialKey : 'darkSteel'
      const mat = materials[matKey]

      let byMaterial = bucketsByGeometry.get(part.geometry)
      if (!byMaterial) {
        byMaterial = new Map()
        bucketsByGeometry.set(part.geometry, byMaterial)
      }

      let bucket = byMaterial.get(mat)
      if (!bucket) {
        bucket = {
          geometry: part.geometry,
          material: mat,
          materialKey: matKey,
          primaryPartName: part.name,
          chunkMatrices: Array.from({ length: propChunkLayout.totalChunks }, () => []),
        }
        byMaterial.set(mat, bucket)
      }

      const partWorldMatrix = new THREE.Matrix4()
      partWorldMatrix.multiplyMatrices(_instPropMatrix, part.localMatrix)
      bucket.chunkMatrices[chunkIdx].push(partWorldMatrix)
      totalSubInstances += 1
    }

    placedMeta.push({
      propId: desc.id || null,
      propType: desc.type,
      row: desc.row,
      col: desc.col,
      wallSide: desc.wallSide || null,
      wallMounted: Boolean(desc.wallMounted),
      position: [px, 0, pz],
      rotationYaw: yaw,
      scale,
    })
    builtCount += 1
  }

  if (builtCount === 0) {
    return null
  }

  let meshCount = 0
  for (const byMaterial of bucketsByGeometry.values()) {
    for (const bucket of byMaterial.values()) {
      const nonEmptyChunks = []
      for (let cIdx = 0; cIdx < bucket.chunkMatrices.length; cIdx += 1) {
        if (bucket.chunkMatrices[cIdx].length > 0) {
          nonEmptyChunks.push({
            chunkIndex: cIdx,
            matrices: bucket.chunkMatrices[cIdx],
          })
        }
      }
      if (nonEmptyChunks.length === 0) continue

      const splitAcrossChunks =
        propChunkLayout.isChunked && nonEmptyChunks.length > 1

      for (let mIdx = 0; mIdx < nonEmptyChunks.length; mIdx += 1) {
        const entry = nonEmptyChunks[mIdx]
        const matrices = entry.matrices
        const count = matrices.length
        const chunkMeta = propChunkLayout.chunks[entry.chunkIndex]
        const instanced = new THREE.InstancedMesh(bucket.geometry, bucket.material, count)
        instanced.name = splitAcrossChunks
          ? `props-instanced-${bucket.primaryPartName}-chunk-${chunkMeta.cx}-${chunkMeta.cz}`
          : `props-instanced-${bucket.primaryPartName}`
        instanced.castShadow = true
        instanced.receiveShadow = true
        instanced.frustumCulled = true
        for (let k = 0; k < count; k += 1) {
          instanced.setMatrixAt(k, matrices[k])
        }
        instanced.instanceMatrix.needsUpdate = true
        instanced.computeBoundingBox()
        instanced.computeBoundingSphere()
        instanced.userData = {
          partName: bucket.primaryPartName,
          layerName: `props-instanced-${bucket.primaryPartName}`,
          materialKey: bucket.materialKey,
          instanceCount: count,
          isSpatialChunk: splitAcrossChunks,
          chunkIndex: chunkMeta ? chunkMeta.index : entry.chunkIndex,
          chunkX: chunkMeta ? chunkMeta.cx : 0,
          chunkZ: chunkMeta ? chunkMeta.cz : 0,
          ...(splitAcrossChunks && chunkMeta
            ? {
                chunkBounds: {
                  minX: chunkMeta.minX,
                  maxX: chunkMeta.maxX,
                  minZ: chunkMeta.minZ,
                  maxZ: chunkMeta.maxZ,
                },
              }
            : null),
        }
        rootGroup.add(instanced)
        meshCount += 1
      }
    }
  }

  rootGroup.userData = {
    propCount: builtCount,
    meshCount,
    instanceCount: totalSubInstances,
    placedProps: placedMeta,
    chunkLayout: {
      chunkCols: propChunkLayout.chunkCols,
      chunkRows: propChunkLayout.chunkRows,
      isChunked: propChunkLayout.isChunked,
    },
  }

  return rootGroup
}

export function syncEnvironmentalPropsQuality(propsGroup, qualityPreset = 'high') {
  if (!propsGroup) return false
  const materials = getEnvironmentalPropMaterials({ qualityPreset })
  propsGroup.traverse((node) => {
    if (!node.isMesh) return
    const key = node.userData?.materialKey
    if (key && materials[key] && node.material !== materials[key]) {
      node.material = materials[key]
    }
  })
  return true
}
