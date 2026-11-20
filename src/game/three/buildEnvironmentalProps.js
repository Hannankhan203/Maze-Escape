import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'
import { placeEnvironmentalProps, PROP_TYPES } from '../generation/environmentalPropPlacement.js'
import { getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import {
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

const propTexturePool = new Map()
const propMaterialPool = new Map()

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
  const fx = (((u % 1) + 1) % 1) * periodX
  const fy = (((v % 1) + 1) % 1) * periodY
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)

  const ix0 = ((x0 % periodX) + periodX) % periodX
  const ix1 = (ix0 + 1) % periodX
  const iy0 = ((y0 % periodY) + periodY) % periodY
  const iy1 = (iy0 + 1) % periodY

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

function createPropDataTexture(bytes, size, colorSpace) {
  const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat)
  tex.colorSpace = colorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 8
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
 * Builds 5 lightweight 256x256 seamless procedural texture trios (albedo, roughness, bump)
 * shared across prop materials. Concrete debris reuses the architectural wall concrete maps.
 */
function buildProceduralPropTextures() {
  const size = 256
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

        let lum = 0.87 + (chalkFbm - 0.5) * 0.16 - grime * 0.14 - chipMask * 0.18 + micro * 0.03
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
        const plankSeam = 1 - smoothstep(0.0, 0.028, Math.min((u * 3) % 1, 1 - ((u * 3) % 1)))
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
        const crease = 1 - smoothstep(0.0, 0.02, Math.abs(((u + v * 0.6) % 1) - 0.5))

        let lum = 0.86 + (pulp - 0.5) * 0.12 - tideRing * 0.16 - soot * 0.18 - crease * 0.08 + micro * 0.025
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

  const finalizeSet = (key, trio) => {
    const bundle = {
      map: createPropDataTexture(trio.albedo, size, THREE.SRGBColorSpace),
      roughnessMap: createPropDataTexture(trio.rough, size, THREE.NoColorSpace),
      bumpMap: createPropDataTexture(trio.bump, size, THREE.NoColorSpace),
    }
    propTexturePool.set(key, bundle)
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

export function getEnvironmentalPropTextureSet() {
  if (propTexturePool.size === 0) {
    return buildProceduralPropTextures()
  }
  return {
    rustMetal: propTexturePool.get('tex:rustMetal'),
    steelGrime: propTexturePool.get('tex:steelGrime'),
    agedPaint: propTexturePool.get('tex:agedPaint'),
    weatheredWood: propTexturePool.get('tex:weatheredWood'),
    stainedPaper: propTexturePool.get('tex:stainedPaper'),
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
 * Returns the shared, calibrated MeshStandardMaterial dictionary for all environmental props.
 * Materials and textures are lazily pooled and marked as shared resources so
 * `disposeMazeGroup()` never invalidates them between maze resets or retries.
 */
export function getEnvironmentalPropMaterials() {
  const texSet = getEnvironmentalPropTextureSet()
  const archSurfaceSet = getMazeSurfaceTextureSet()

  const debrisMat = getPooledPropMaterial(
    'mat:debrisConcrete',
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
    rustyMetal: getPooledPropMaterial('mat:rustyMetal', PROP_MATERIAL_PALETTE.rustyMetal, texSet.rustMetal),
    darkSteel: getPooledPropMaterial('mat:darkSteel', PROP_MATERIAL_PALETTE.darkSteel, texSet.steelGrime),
    weatheredWood: getPooledPropMaterial('mat:weatheredWood', PROP_MATERIAL_PALETTE.weatheredWood, texSet.weatheredWood),
    cabinetGreen: getPooledPropMaterial('mat:cabinetGreen', PROP_MATERIAL_PALETTE.cabinetGreen, texSet.agedPaint),
    lockerBlue: getPooledPropMaterial('mat:lockerBlue', PROP_MATERIAL_PALETTE.lockerBlue, texSet.agedPaint),
    warningYellow: getPooledPropMaterial('mat:warningYellow', PROP_MATERIAL_PALETTE.warningYellow, texSet.agedPaint),
    paperWhite: getPooledPropMaterial('mat:paperWhite', PROP_MATERIAL_PALETTE.paperWhite, texSet.stainedPaper),
    debrisConcrete: debrisMat,
    cableBlack: getPooledPropMaterial('mat:cableBlack', PROP_MATERIAL_PALETTE.cableBlack, texSet.steelGrime),
  }
}

export function disposeEnvironmentalPropPools() {
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
  }
}

registerSharedPoolClearer(disposeEnvironmentalPropPools)

function configureShadows(group) {
  group.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })
}

function buildBrokenDesk(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-desk-broken'

  // Top slab (tilted / damaged)
  const topGeo = new THREE.BoxGeometry(1.2, 0.09, 0.7)
  const topMesh = new THREE.Mesh(topGeo, materials.weatheredWood)
  topMesh.position.set(0, 0.76, 0)
  topMesh.rotation.z = 0.12
  topMesh.rotation.x = -0.05
  group.add(topMesh)

  // 4 Legs (one missing/broken), bottom flush at y = 0
  const legGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8)
  const legPositions = [
    [-0.52, 0.36, -0.28],
    [0.52, 0.36, -0.28],
    [-0.52, 0.36, 0.28],
  ]
  for (let i = 0; i < legPositions.length; i += 1) {
    const p = legPositions[i]
    const leg = new THREE.Mesh(legGeo, materials.rustyMetal)
    leg.position.set(p[0], p[1], p[2])
    group.add(leg)
  }

  // Broken leg resting underneath flush on the floor (halfY = 0.36*cos(PI/3) + 0.035*sin(PI/3) ~= 0.211)
  const brokenLeg = new THREE.Mesh(legGeo, materials.rustyMetal)
  brokenLeg.position.set(0.3, 0.211, 0.1)
  brokenLeg.rotation.z = Math.PI / 3
  group.add(brokenLeg)

  // Scattered papers & folders resting directly on the tilted desk surface
  const paperGeo = new THREE.BoxGeometry(0.28, 0.015, 0.2)
  const paper1 = new THREE.Mesh(paperGeo, materials.paperWhite)
  paper1.position.set(-0.2, 0.053, 0.1)
  paper1.rotation.y = 0.35
  topMesh.add(paper1)

  const paper2 = new THREE.Mesh(paperGeo, materials.paperWhite)
  paper2.position.set(0.25, 0.053, -0.1)
  paper2.rotation.y = -0.55
  topMesh.add(paper2)

  configureShadows(group)
  return group
}

function buildBrokenChair(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-chair-broken'

  // Seat
  const seatGeo = new THREE.BoxGeometry(0.44, 0.07, 0.44)
  const seat = new THREE.Mesh(seatGeo, materials.weatheredWood)
  seat.position.set(0, 0.42, 0)
  seat.rotation.z = 0.15
  group.add(seat)

  // Broken backrest slat
  const backGeo = new THREE.BoxGeometry(0.4, 0.42, 0.06)
  const back = new THREE.Mesh(backGeo, materials.weatheredWood)
  back.position.set(-0.1, 0.68, -0.18)
  back.rotation.z = -0.3
  group.add(back)

  // Legs grounded at y = 0 (bent front-right leg raised to account for rotation.x = 0.4)
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 8)
  const legPositions = [
    [-0.18, 0.21, -0.18],
    [0.18, 0.21, -0.18],
    [-0.18, 0.21, 0.18],
    [0.16, 0.204, 0.18],
  ]
  for (let i = 0; i < legPositions.length; i += 1) {
    const p = legPositions[i]
    const leg = new THREE.Mesh(legGeo, materials.rustyMetal)
    leg.position.set(p[0], p[1], p[2])
    if (i === 3) leg.rotation.x = 0.4
    group.add(leg)
  }

  configureShadows(group)
  return group
}

function buildOverturnedChair(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-chair-overturned'

  const bodyGroup = new THREE.Group()

  const seatGeo = new THREE.BoxGeometry(0.48, 0.08, 0.48)
  const seat = new THREE.Mesh(seatGeo, materials.darkSteel)
  seat.position.set(0, 0.22, 0)
  bodyGroup.add(seat)

  const backGeo = new THREE.BoxGeometry(0.44, 0.46, 0.07)
  const back = new THREE.Mesh(backGeo, materials.darkSteel)
  back.position.set(0, 0.48, -0.22)
  bodyGroup.add(back)

  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8)
  const pole = new THREE.Mesh(poleGeo, materials.rustyMetal)
  pole.position.set(0.25, 0.25, 0)
  pole.rotation.z = Math.PI / 2
  bodyGroup.add(pole)

  bodyGroup.rotation.x = Math.PI / 2.3
  bodyGroup.rotation.y = Math.PI * 0.4
  bodyGroup.updateMatrixWorld(true)

  const bounds = new THREE.Box3().setFromObject(bodyGroup)
  const center = bounds.getCenter(new THREE.Vector3())
  bodyGroup.position.set(-center.x, -bounds.min.y, -center.z)
  group.add(bodyGroup)

  configureShadows(group)
  return group
}

function buildFilingCabinet(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-filing-cabinet'

  const bodyGeo = new THREE.BoxGeometry(0.55, 1.3, 0.6)
  const body = new THREE.Mesh(bodyGeo, materials.cabinetGreen)
  body.position.set(0, 0.65, 0)
  group.add(body)

  // Top drawer pulled open
  const drawerGeo = new THREE.BoxGeometry(0.51, 0.26, 0.58)
  const drawer = new THREE.Mesh(drawerGeo, materials.rustyMetal)
  drawer.position.set(0, 1.1, 0.16)
  group.add(drawer)

  configureShadows(group)
  return group
}

function buildFilingCabinetOverturned(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-filing-cabinet-overturned'

  const bodyGroup = new THREE.Group()
  const bodyGeo = new THREE.BoxGeometry(0.55, 1.3, 0.6)
  const body = new THREE.Mesh(bodyGeo, materials.cabinetGreen)
  body.position.set(0, 0.3, 0)
  bodyGroup.add(body)

  bodyGroup.rotation.z = Math.PI / 2
  bodyGroup.rotation.y = 0.3
  bodyGroup.updateMatrixWorld(true)

  const bounds = new THREE.Box3().setFromObject(bodyGroup)
  const center = bounds.getCenter(new THREE.Vector3())
  bodyGroup.position.set(-center.x, -bounds.min.y, -center.z)
  group.add(bodyGroup)

  configureShadows(group)
  return group
}

function buildStorageLocker(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-storage-locker'

  const lockerGeo = new THREE.BoxGeometry(0.65, 1.8, 0.55)
  const locker = new THREE.Mesh(lockerGeo, materials.lockerBlue)
  locker.position.set(0, 0.9, 0)
  group.add(locker)

  // Locker door ajar
  const doorGeo = new THREE.BoxGeometry(0.62, 1.76, 0.04)
  const door = new THREE.Mesh(doorGeo, materials.rustyMetal)
  door.position.set(0.35, 0.9, 0.25)
  door.rotation.y = -0.75
  group.add(door)

  configureShadows(group)
  return group
}

function buildStorageShelf(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-storage-shelf'

  const frameGeo = new THREE.BoxGeometry(0.95, 1.7, 0.48)
  const frame = new THREE.Mesh(frameGeo, materials.rustyMetal)
  frame.position.set(0, 0.85, 0)
  group.add(frame)

  const crateGeo = new THREE.BoxGeometry(0.42, 0.38, 0.4)
  const crate = new THREE.Mesh(crateGeo, materials.weatheredWood)
  crate.position.set(-0.16, 0.58, 0)
  group.add(crate)

  configureShadows(group)
  return group
}

function buildIndustrialBarrel(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-industrial-barrel'

  const drumGeo = new THREE.CylinderGeometry(0.35, 0.33, 0.92, 16)
  const drum = new THREE.Mesh(drumGeo, materials.warningYellow)
  drum.position.set(0, 0.46, 0)
  group.add(drum)

  configureShadows(group)
  return group
}

function buildWoodenCrate(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-wooden-crate'

  const crateGeo = new THREE.BoxGeometry(0.58, 0.58, 0.58)
  const crate = new THREE.Mesh(crateGeo, materials.weatheredWood)
  crate.position.set(0, 0.29, 0)
  group.add(crate)

  configureShadows(group)
  return group
}

function buildToolbox(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-toolbox'

  const boxGeo = new THREE.BoxGeometry(0.45, 0.26, 0.28)
  const box = new THREE.Mesh(boxGeo, materials.warningYellow)
  box.position.set(0, 0.13, 0)
  group.add(box)

  configureShadows(group)
  return group
}

function buildElectricalPanel(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-electrical-panel'

  const boxGeo = new THREE.BoxGeometry(0.5, 0.68, 0.2)
  const box = new THREE.Mesh(boxGeo, materials.darkSteel)
  box.position.set(0, 1.25, 0)
  group.add(box)

  const cableGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.65, 6)
  const cable = new THREE.Mesh(cableGeo, materials.cableBlack)
  cable.position.set(0.14, 0.72, -0.05)
  cable.rotation.z = 0.38
  group.add(cable)

  configureShadows(group)
  return group
}

function buildDebrisPile(materials = getEnvironmentalPropMaterials()) {
  const group = new THREE.Group()
  group.name = 'prop-debris-pile'

  const chunkGeo1 = new THREE.BoxGeometry(0.38, 0.2, 0.32)
  const chunk1 = new THREE.Mesh(chunkGeo1, materials.debrisConcrete)
  chunk1.position.set(0, 0.1, 0)
  chunk1.rotation.y = 0.45
  group.add(chunk1)

  const chunkGeo2 = new THREE.BoxGeometry(0.26, 0.14, 0.28)
  const chunk2 = new THREE.Mesh(chunkGeo2, materials.debrisConcrete)
  chunk2.position.set(0.24, 0.07, -0.16)
  chunk2.rotation.y = -0.65
  group.add(chunk2)

  const paperGeo = new THREE.BoxGeometry(0.24, 0.015, 0.18)
  const paper = new THREE.Mesh(paperGeo, materials.paperWhite)
  paper.position.set(-0.28, 0.008, 0.14)
  paper.rotation.y = 0.85
  group.add(paper)

  configureShadows(group)
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
 * Builds and returns a THREE.Group containing procedurally placed environmental props.
 */
export function buildEnvironmentalProps(maze, options = {}) {
  const propList = placeEnvironmentalProps(maze, options)
  if (!propList || propList.length === 0) {
    return null
  }

  const materials = getEnvironmentalPropMaterials()
  const rootGroup = new THREE.Group()
  rootGroup.name = 'maze-environmental-props'

  let builtCount = 0
  for (let i = 0; i < propList.length; i += 1) {
    const desc = propList[i]
    const builder = PROP_BUILDERS[desc.type] || buildDebrisPile
    const propMesh = builder(materials)

    const worldPos = gridToWorld(desc.row, desc.col, maze)
    if (!worldPos) continue

    const px = worldPos.x + (desc.offsetX || 0)
    const pz = worldPos.z + (desc.offsetZ || 0)

    propMesh.position.set(px, 0, pz)
    propMesh.rotation.y = desc.rotationYaw || 0
    if (desc.scale && desc.scale > 0) {
      propMesh.scale.setScalar(desc.scale)
    }
    propMesh.userData = {
      propId: desc.id || null,
      propType: desc.type,
      row: desc.row,
      col: desc.col,
      wallSide: desc.wallSide || null,
      wallMounted: Boolean(desc.wallMounted),
    }

    rootGroup.add(propMesh)
    builtCount += 1
  }

  rootGroup.userData = {
    propCount: builtCount,
  }

  return builtCount > 0 ? rootGroup : null
}
