import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createRng } from '../../utils/rng.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import {
  GRAFFITI_ATLAS_UVS,
  applyWorldSpaceConcreteShader,
  getMazeSurfaceTextureSet,
} from './mazeSurfaceTextures.js'
import { isSharedResource, markSharedResource, registerSharedPoolClearer } from './sharedResources.js'

const BACKDROP_POOL = new Map()

const _tmpColor = new THREE.Color()
const _zenithColor = new THREE.Color(0x04070d)
const _midSkyColor = new THREE.Color(0x101a2a)
const _driftSkyColor = new THREE.Color(0x152439)
const _horizonColor = new THREE.Color(0x0b111b)
const _abyssColor = new THREE.Color(0x050810)
const _workColor = new THREE.Color()

const VALID_QUALITY_TIERS = new Set(['performance', 'balanced', 'high'])

export function normalizeBackdropQualityTier(qualityPreset) {
  return VALID_QUALITY_TIERS.has(qualityPreset) ? qualityPreset : 'high'
}

function getPooledAsset(key, factory) {
  if (!BACKDROP_POOL.has(key)) {
    BACKDROP_POOL.set(key, factory())
  }
  return BACKDROP_POOL.get(key)
}

function createBeaconHaloTexture() {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const center = (size - 1) * 0.5

  for (let y = 0; y < size; y += 1) {
    const dy = (y - center) / center
    for (let x = 0; x < size; x += 1) {
      const dx = (x - center) / center
      const dist = Math.min(1, Math.hypot(dx, dy))
      const core = Math.pow(1 - dist, 2.6)
      const outer = Math.pow(1 - dist, 1.35) * 0.35
      const alpha = Math.max(0, Math.min(1, core * 0.8 + outer))
      const p = (y * size + x) * 4
      data[p] = 255
      data[p + 1] = 255
      data[p + 2] = 255
      data[p + 3] = Math.round(alpha * 255)
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return markSharedResource(tex)
}

export function disposeBackdropSharedPools() {
  for (const entry of BACKDROP_POOL.values()) {
    entry?.dispose?.()
  }
  BACKDROP_POOL.clear()
}

export function getBackdropPoolStats() {
  return {
    entries: BACKDROP_POOL.size,
  }
}

registerSharedPoolClearer(disposeBackdropSharedPools)

function mergeStaticGeometries(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const normalized = []
  try {
    for (let i = 0; i < list.length; i += 1) {
      const geo = list[i]
      if (!geo) continue
      const nonIndexed = geo.index ? geo.toNonIndexed() : geo
      if (nonIndexed !== geo) {
        geo.dispose()
      }
      normalized.push(nonIndexed)
    }
    if (normalized.length === 0) return null
    const merged = mergeGeometries(normalized, false)
    if (merged) {
      merged.computeBoundingBox()
      merged.computeBoundingSphere()
    }
    return merged || null
  } finally {
    for (let i = 0; i < normalized.length; i += 1) {
      normalized[i]?.dispose?.()
    }
  }
}

/**
 * Creates a deep midnight-slate subterranean cavern dome (`THREE.BackSide`, fog-free)
 * whose horizon band blends seamlessly into `fogColor` while its upper vault darkens
 * into heavy cavernous slate-charcoal with subtle azimuthal air-shaft variation.
 */
function createCavernSkyDome(span, horizonColorHex) {
  const halfMax = Math.max(span.width, span.depth) * 0.5
  const radius = Math.max(165, Math.min(240, halfMax * 2.1 + 75))
  const geo = new THREE.SphereGeometry(radius, 28, 16)
  const posAttr = geo.attributes.position
  const colors = new Float32Array(posAttr.count * 3)

  _horizonColor.setHex(
    typeof horizonColorHex === 'number' ? horizonColorHex : 0x0b111b
  )

  for (let i = 0; i < posAttr.count; i += 1) {
    const x = posAttr.getX(i)
    const y = posAttr.getY(i)
    const z = posAttr.getZ(i)
    const len = Math.hypot(x, y, z) || 1
    const ny = y / len
    const angle = Math.atan2(z, x)

    if (ny < 0) {
      const t = Math.min(1, -ny / 0.35)
      _workColor.copy(_horizonColor).lerp(_abyssColor, t)
    } else if (ny < 0.24) {
      const t = ny / 0.24
      const smooth = t * t * (3 - 2 * t)
      const drift = 0.5 + 0.5 * Math.sin(angle * 2.0 + 0.85)
      _tmpColor.copy(_midSkyColor).lerp(_driftSkyColor, drift * 0.45)
      _workColor.copy(_horizonColor).lerp(_tmpColor, smooth)
    } else {
      const t = Math.min(1, (ny - 0.24) / 0.72)
      const smooth = t * t * (3 - 2 * t)
      const drift = 0.5 + 0.5 * Math.sin(angle * 2.0 + 0.85)
      // Subtle structural rib shadow bands high overhead
      const coffer = 0.94 + 0.06 * Math.cos(angle * 6.0) * (1 - ny * 0.6)
      _tmpColor.copy(_midSkyColor).lerp(_driftSkyColor, drift * 0.45)
      _workColor.copy(_tmpColor).lerp(_zenithColor, smooth)
      _workColor.multiplyScalar(coffer)
    }

    colors[i * 3] = _workColor.r
    colors[i * 3 + 1] = _workColor.g
    colors[i * 3 + 2] = _workColor.b
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeBoundingSphere()

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  })

  const dome = new THREE.Mesh(geo, mat)
  dome.name = 'maze-env-sky-dome'
  dome.renderOrder = -10
  dome.frustumCulled = false
  return dome
}

/**
 * Extended dark concrete sub-facility floor slab surrounding the maze plinth and
 * dissolving cleanly into the distant exponential haze.
 */
function createOuterApronFloor(span, surfaceSet) {
  const apronW = span.width + 96
  const apronD = span.depth + 96
  const geo = new THREE.PlaneGeometry(apronW, apronD, 1, 1)
  geo.rotateX(-Math.PI / 2)

  const uvAttr = geo.attributes.uv
  const repeatX = apronW / (CELL_SIZE * 2)
  const repeatZ = apronD / (CELL_SIZE * 2)
  for (let i = 0; i < uvAttr.count; i += 1) {
    uvAttr.setXY(i, uvAttr.getX(i) * repeatX, uvAttr.getY(i) * repeatZ)
  }
  uvAttr.needsUpdate = true

  const mat = new THREE.MeshStandardMaterial({
    color: 0x0e1623,
    map: surfaceSet.floor.map,
    roughness: 0.96,
    metalness: 0.05,
  })

  const apron = new THREE.Mesh(geo, mat)
  apron.name = 'maze-env-apron'
  apron.position.set(0, -0.72, 0)
  apron.receiveShadow = false
  apron.castShadow = false
  return apron
}

const PILLAR_APRON_Y = -0.72
const UPPER_VAULT_SOFFIT_Y = 14.2
const UPPER_PILLAR_HEIGHT = UPPER_VAULT_SOFFIT_Y - PILLAR_APRON_Y

function collectPillarLayout(span, tier) {
  const halfW = span.width * 0.5
  const halfD = span.depth * 0.5
  const innerOffset = 12.5
  const outerOffset = 26.5

  const innerSpanX = halfW + innerOffset
  const innerSpanZ = halfD + innerOffset
  const outerSpanX = halfW + outerOffset
  const outerSpanZ = halfD + outerOffset
  const pillars = []

  // Inner structural ring: 4 corners + spaced side buttresses rising from floor apron to upper cavern soffit
  const sideSteps = tier === 'performance' ? 1 : tier === 'balanced' ? 2 : 3
  const corners = [
    [-innerSpanX, -innerSpanZ],
    [innerSpanX, -innerSpanZ],
    [innerSpanX, innerSpanZ],
    [-innerSpanX, innerSpanZ],
  ]
  for (let i = 0; i < corners.length; i += 1) {
    pillars.push({
      x: corners[i][0],
      z: corners[i][1],
      ring: 0,
      height: UPPER_PILLAR_HEIGHT,
      width: 2.8,
      inwardNx: -Math.sign(corners[i][0]),
      inwardNz: 0,
    })
  }

  for (let s = 1; s <= sideSteps; s += 1) {
    const frac = s / (sideSteps + 1)
    const px = -innerSpanX + frac * innerSpanX * 2
    const pz = -innerSpanZ + frac * innerSpanZ * 2
    pillars.push({ x: px, z: -innerSpanZ, ring: 0, height: UPPER_PILLAR_HEIGHT, width: 2.5, inwardNx: 0, inwardNz: 1 })
    pillars.push({ x: px, z: innerSpanZ, ring: 0, height: UPPER_PILLAR_HEIGHT, width: 2.5, inwardNx: 0, inwardNz: -1 })
    pillars.push({ x: -innerSpanX, z: pz, ring: 0, height: UPPER_PILLAR_HEIGHT, width: 2.5, inwardNx: 1, inwardNz: 0 })
    pillars.push({ x: innerSpanX, z: pz, ring: 0, height: UPPER_PILLAR_HEIGHT, width: 2.5, inwardNx: -1, inwardNz: 0 })
  }

  // Outer structural pier ring receding into deep mist (balanced/high only)
  if (tier !== 'performance') {
    const outerCount = tier === 'high' ? 2 : 1
    for (let s = 1; s <= outerCount; s += 1) {
      const frac = s / (outerCount + 1)
      const ox = -outerSpanX + frac * outerSpanX * 2
      const oz = -outerSpanZ + frac * outerSpanZ * 2
      pillars.push({ x: ox, z: -outerSpanZ, ring: 1, height: UPPER_PILLAR_HEIGHT, width: 3.2, inwardNx: 0, inwardNz: 1 })
      pillars.push({ x: ox, z: outerSpanZ, ring: 1, height: UPPER_PILLAR_HEIGHT, width: 3.2, inwardNx: 0, inwardNz: -1 })
      pillars.push({ x: -outerSpanX, z: oz, ring: 1, height: UPPER_PILLAR_HEIGHT, width: 3.2, inwardNx: 1, inwardNz: 0 })
      pillars.push({ x: outerSpanX, z: oz, ring: 1, height: UPPER_PILLAR_HEIGHT, width: 3.2, inwardNx: -1, inwardNz: 0 })
    }
  }

  return { pillars, innerSpanX, innerSpanZ, outerSpanX, outerSpanZ }
}

/**
 * Instanced concrete facility support piers with stepped foundation footings,
 * mid-shaft bracing collars, and flared ceiling capitals carrying the upper cavern roof.
 */
function createOuterConcretePillars(
  pillars,
  surfaceSet,
  rng,
  worldSeed,
  qualityPreset = 'high'
) {
  if (!pillars.length) return []

  const pillarGeo = new THREE.BoxGeometry(1, 1, 1)
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x202d40,
    map: surfaceSet.wall.map,
    roughnessMap: surfaceSet.wall.roughnessMap,
    bumpMap: surfaceSet.wall.bumpMap,
    bumpScale: 0.042,
    roughness: 0.94,
    metalness: 0.03,
    envMapIntensity: 0.44,
  })
  applyWorldSpaceConcreteShader(pillarMat, {
    mode: 'ceiling',
    seed: worldSeed,
    qualityPreset,
  })

  const pillarMesh = new THREE.InstancedMesh(pillarGeo, pillarMat, pillars.length)
  pillarMesh.name = 'maze-env-pillars'
  pillarMesh.castShadow = false
  pillarMesh.receiveShadow = false

  const collarGeo = new THREE.BoxGeometry(1, 1, 1)
  const collarMat = new THREE.MeshStandardMaterial({
    color: 0x26364d,
    map: surfaceSet.cap.map,
    bumpMap: surfaceSet.cap.bumpMap,
    bumpScale: 0.028,
    roughness: 0.88,
    metalness: 0.06,
  })
  applyWorldSpaceConcreteShader(collarMat, {
    mode: 'cap',
    seed: worldSeed,
    qualityPreset,
  })

  // 2 horizontal concrete corbel collars per pillar
  const collarMesh = new THREE.InstancedMesh(collarGeo, collarMat, pillars.length * 2)
  collarMesh.name = 'maze-env-pillar-collars'
  collarMesh.castShadow = false
  collarMesh.receiveShadow = false

  // Stepped concrete foundation plinths anchoring pillars to cavern apron
  const baseGeo = new THREE.BoxGeometry(1, 1, 1)
  const baseMesh = new THREE.InstancedMesh(baseGeo, collarMat, pillars.length)
  baseMesh.name = 'maze-env-pillar-bases'
  baseMesh.castShadow = false
  baseMesh.receiveShadow = false

  // Flared structural concrete support capitals meeting the upper vault girders
  const capitalGeo = new THREE.BoxGeometry(1, 1, 1)
  const capitalMesh = new THREE.InstancedMesh(capitalGeo, collarMat, pillars.length)
  capitalMesh.name = 'maze-env-pillar-capitals'
  capitalMesh.castShadow = false
  capitalMesh.receiveShadow = false

  const dummy = new THREE.Object3D()
  const tint = new THREE.Color()

  for (let i = 0; i < pillars.length; i += 1) {
    const p = pillars[i]
    dummy.position.set(p.x, PILLAR_APRON_Y + p.height * 0.5, p.z)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(p.width, p.height, p.width)
    dummy.updateMatrix()
    pillarMesh.setMatrixAt(i, dummy.matrix)

    const shade = (p.ring === 0 ? 0.9 : 0.78) + rng() * 0.16
    tint.setRGB(shade, shade + 0.01, shade + 0.02, THREE.SRGBColorSpace)
    pillarMesh.setColorAt(i, tint)

    // Stepped concrete foundation base (y = -0.72 .. 0.56)
    dummy.position.set(p.x, PILLAR_APRON_Y + 0.64, p.z)
    dummy.scale.set(p.width + 1.18, 1.28, p.width + 1.18)
    dummy.updateMatrix()
    baseMesh.setMatrixAt(i, dummy.matrix)
    baseMesh.setColorAt(i, tint)

    // Mid-shaft structural collars (y = 6.4 and y = 11.1, clear of 5.1m markings and 12.9m capitals)
    const collarHeights = [6.4, 11.1]
    for (let cIdx = 0; cIdx < collarHeights.length; cIdx += 1) {
      const idx = i * 2 + cIdx
      dummy.position.set(p.x, collarHeights[cIdx], p.z)
      dummy.scale.set(p.width + 0.72, 0.82, p.width + 0.72)
      dummy.updateMatrix()
      collarMesh.setMatrixAt(idx, dummy.matrix)
      collarMesh.setColorAt(idx, tint)
    }

    // Flared capital corbel cradling the upper vault girder ring (y = 12.90 .. 14.20)
    dummy.position.set(p.x, UPPER_VAULT_SOFFIT_Y - 0.65, p.z)
    dummy.scale.set(p.width + 1.48, 1.3, p.width + 1.48)
    dummy.updateMatrix()
    capitalMesh.setMatrixAt(i, dummy.matrix)
    capitalMesh.setColorAt(i, tint)
  }

  for (const mesh of [pillarMesh, collarMesh, baseMesh, capitalMesh]) {
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
  }

  return [pillarMesh, collarMesh, baseMesh, capitalMesh]
}

function scaleBoxWorldUvs(boxGeo, width, height, depth, tileUnits = CELL_SIZE * 2) {
  const posAttr = boxGeo.attributes.position
  const normAttr = boxGeo.attributes.normal
  const uvAttr = boxGeo.attributes.uv
  if (!posAttr || !normAttr || !uvAttr) return boxGeo

  const invTile = 1 / tileUnits
  for (let i = 0; i < posAttr.count; i += 1) {
    const x = posAttr.getX(i)
    const y = posAttr.getY(i)
    const z = posAttr.getZ(i)
    const ny = Math.abs(normAttr.getY(i))
    const nx = Math.abs(normAttr.getX(i))
    if (ny > 0.5) {
      uvAttr.setXY(i, (x + width * 0.5) * invTile, (z + depth * 0.5) * invTile)
    } else if (nx > 0.5) {
      uvAttr.setXY(i, (z + depth * 0.5) * invTile, (y + height * 0.5) * invTile)
    } else {
      uvAttr.setXY(i, (x + width * 0.5) * invTile, (y + height * 0.5) * invTile)
    }
  }
  uvAttr.needsUpdate = true
  return boxGeo
}

/**
 * Builds the upper subterranean concrete cavern roof deck & structural girder
 * rings physically carried by the outer Ring 0 / Ring 1 facility support pillars.
 */
function createUpperCavernVaultRoof(
  innerSpanX,
  innerSpanZ,
  outerSpanX,
  outerSpanZ,
  surfaceSet,
  tier,
  worldSeed
) {
  const parts = []
  const vaultW = (tier === 'performance' ? innerSpanX + 20 : outerSpanX + 18) * 2
  const vaultD = (tier === 'performance' ? innerSpanZ + 20 : outerSpanZ + 18) * 2
  const slabThick = 1.65

  // Heavy upper cavern concrete ceiling slab (y = 14.20 .. 15.85m)
  const slabGeo = scaleBoxWorldUvs(
    new THREE.BoxGeometry(vaultW, slabThick, vaultD),
    vaultW,
    slabThick,
    vaultD
  )
  slabGeo.translate(0, UPPER_VAULT_SOFFIT_Y + slabThick * 0.5, 0)
  parts.push(slabGeo)

  // Concrete transfer girders directly linking Ring 0 pillar tops (y = 13.45 .. 14.20m)
  const girderH = 0.78
  const girderY = UPPER_VAULT_SOFFIT_Y - girderH * 0.5
  const girderW = 2.45

  const addGirder = (cx, cy, cz, sx, sy, sz) => {
    const g = scaleBoxWorldUvs(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz)
    g.translate(cx, cy, cz)
    parts.push(g)
  }

  addGirder(0, girderY, -innerSpanZ, innerSpanX * 2 + girderW, girderH, girderW)
  addGirder(0, girderY, innerSpanZ, innerSpanX * 2 + girderW, girderH, girderW)
  addGirder(-innerSpanX, girderY, 0, girderW, girderH, innerSpanZ * 2 - girderW)
  addGirder(innerSpanX, girderY, 0, girderW, girderH, innerSpanZ * 2 - girderW)

  if (tier !== 'performance') {
    addGirder(0, girderY, -outerSpanZ, outerSpanX * 2 + 2.8, girderH, 2.8)
    addGirder(0, girderY, outerSpanZ, outerSpanX * 2 + 2.8, girderH, 2.8)
    addGirder(-outerSpanX, girderY, 0, 2.8, girderH, outerSpanZ * 2 - 2.8)
    addGirder(outerSpanX, girderY, 0, 2.8, girderH, outerSpanZ * 2 - 2.8)
  }

  const vaultGeo = mergeStaticGeometries(parts)
  if (!vaultGeo) return null

  const vaultMat = new THREE.MeshStandardMaterial({
    color: 0x162030,
    map: surfaceSet.ceiling.map,
    roughnessMap: surfaceSet.ceiling.roughnessMap,
    bumpMap: surfaceSet.ceiling.bumpMap,
    bumpScale: 0.04,
    roughness: 0.95,
    metalness: 0.02,
    envMapIntensity: 0.4,
  })
  applyWorldSpaceConcreteShader(vaultMat, {
    mode: 'ceiling',
    seed: worldSeed,
    qualityPreset: tier,
  })

  const vaultMesh = new THREE.Mesh(vaultGeo, vaultMat)
  vaultMesh.name = 'maze-env-ceiling-vault'
  vaultMesh.castShadow = false
  vaultMesh.receiveShadow = false
  return vaultMesh
}

/**
 * Builds high-clearance industrial steel gantries, HVAC ventilation ducts, and
 * draped catenary cables above the facility ceiling plane (`y >= 8.6m`), staying
 * cleanly above both 3m maze walls and the 2.75m third-person camera ceiling.
 */
function createOverheadInfrastructure(span, innerSpanX, innerSpanZ, tier, rng) {
  const meshes = []

  // 1. Structural Steel Gantries & Cross-Trusses (y = 11.4m .. 13.6m)
  const gantryParts = []
  const gantryY = 12.6
  const crossOffsets =
    tier === 'performance'
      ? [-innerSpanZ * 0.45, innerSpanZ * 0.45]
      : [-innerSpanZ * 0.58, 0, innerSpanZ * 0.58]

  // Outer perimeter ring beams linking concrete pillars
  const ringBeamY = 12.6
  const northBeam = new THREE.BoxGeometry(innerSpanX * 2, 0.78, 0.92)
  northBeam.translate(0, ringBeamY, -innerSpanZ)
  gantryParts.push(northBeam)

  const southBeam = new THREE.BoxGeometry(innerSpanX * 2, 0.78, 0.92)
  southBeam.translate(0, ringBeamY, innerSpanZ)
  gantryParts.push(southBeam)

  const westBeam = new THREE.BoxGeometry(0.92, 0.78, innerSpanZ * 2)
  westBeam.translate(-innerSpanX, ringBeamY, 0)
  gantryParts.push(westBeam)

  const eastBeam = new THREE.BoxGeometry(0.92, 0.78, innerSpanZ * 2)
  eastBeam.translate(innerSpanX, ringBeamY, 0)
  gantryParts.push(eastBeam)

  // Overhead cross-gantry girders spanning across X above the maze
  for (let i = 0; i < crossOffsets.length; i += 1) {
    const z = crossOffsets[i]
    const upper = new THREE.BoxGeometry(innerSpanX * 2, 0.46, 0.52)
    upper.translate(0, gantryY + 0.55, z)
    gantryParts.push(upper)

    const lower = new THREE.BoxGeometry(innerSpanX * 2, 0.34, 0.42)
    lower.translate(0, gantryY - 0.55, z)
    gantryParts.push(lower)

    // Vertical truss web posts along the girder
    const postCount = tier === 'performance' ? 4 : 7
    for (let k = 1; k < postCount; k += 1) {
      const px = -innerSpanX + (k / postCount) * innerSpanX * 2
      const strut = new THREE.BoxGeometry(0.24, 0.85, 0.32)
      strut.translate(px, gantryY, z)
      gantryParts.push(strut)
    }
  }

  const gantryGeo = mergeStaticGeometries(gantryParts)
  if (gantryGeo) {
    const gantryMat = new THREE.MeshStandardMaterial({
      color: 0x1a2536,
      roughness: 0.7,
      metalness: 0.46,
    })
    const gantryMesh = new THREE.Mesh(gantryGeo, gantryMat)
    gantryMesh.name = 'maze-env-gantries'
    gantryMesh.castShadow = false
    gantryMesh.receiveShadow = false
    meshes.push(gantryMesh)
  }

  // 2. Industrial HVAC Ventilation Ducts & Exhaust Plenums (y = 10.6m .. 11.8m)
  const ventParts = []
  const ventLinesX = tier === 'performance' ? [-span.width * 0.28] : [-span.width * 0.3, span.width * 0.3]
  const ventY = 10.75

  for (let i = 0; i < ventLinesX.length; i += 1) {
    const vx = ventLinesX[i]
    const trunk = new THREE.BoxGeometry(1.75, 1.35, innerSpanZ * 2)
    trunk.translate(vx, ventY, 0)
    ventParts.push(trunk)

    // Periodic flanged duct collars + vertical exhaust risers on outer rim
    const flangeCount = tier === 'performance' ? 4 : 6
    for (let f = 0; f < flangeCount; f += 1) {
      const fz = -innerSpanZ * 0.8 + (f / Math.max(1, flangeCount - 1)) * (innerSpanZ * 1.6)
      const collar = new THREE.BoxGeometry(2.02, 1.56, 0.24)
      collar.translate(vx, ventY, fz)
      ventParts.push(collar)
    }

    // Perimeter downward exhaust plenum stacks outside the maze perimeter
    for (const endZ of [-innerSpanZ + 1.2, innerSpanZ - 1.2]) {
      const stack = new THREE.BoxGeometry(1.45, 7.2, 1.45)
      stack.translate(vx, ventY - 3.6, endZ)
      ventParts.push(stack)
    }
  }

  const ventGeo = mergeStaticGeometries(ventParts)
  if (ventGeo) {
    const ventMat = new THREE.MeshStandardMaterial({
      color: 0x223045,
      roughness: 0.62,
      metalness: 0.38,
    })
    const ventMesh = new THREE.Mesh(ventGeo, ventMat)
    ventMesh.name = 'maze-env-vents'
    ventMesh.castShadow = false
    ventMesh.receiveShadow = false
    meshes.push(ventMesh)
  }

  // 3. Overhead Draped Catenary Power Cables (all lowest points y >= 8.6m)
  const cableParts = []
  const cableCount = tier === 'performance' ? 3 : tier === 'balanced' ? 6 : 9
  const tubularSegs = tier === 'performance' ? 8 : 12

  for (let c = 0; c < cableCount; c += 1) {
    const alongX = c % 2 === 0
    const offsetFrac = -0.68 + ((c / Math.max(1, cableCount - 1)) * 1.36)
    const startY = 11.4 + rng() * 1.3
    const endY = 11.4 + rng() * 1.3
    const sag = 1.4 + rng() * 1.35 // Lowest point >= 11.4 - 2.75 = 8.65m (> 8.6m!)

    const p0 = alongX
      ? new THREE.Vector3(-innerSpanX, startY, offsetFrac * innerSpanZ * 0.82)
      : new THREE.Vector3(offsetFrac * innerSpanX * 0.82, startY, -innerSpanZ)
    const p2 = alongX
      ? new THREE.Vector3(innerSpanX, endY, (offsetFrac + (rng() - 0.5) * 0.14) * innerSpanZ * 0.82)
      : new THREE.Vector3((offsetFrac + (rng() - 0.5) * 0.14) * innerSpanX * 0.82, endY, innerSpanZ)
    const mid = new THREE.Vector3()
      .addVectors(p0, p2)
      .multiplyScalar(0.5)
    mid.y = Math.max(8.7, mid.y - sag)

    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2)
    cableParts.push(new THREE.TubeGeometry(curve, tubularSegs, 0.065, 5, false))
  }

  const cableGeo = mergeStaticGeometries(cableParts)
  if (cableGeo) {
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0x0d131e,
      roughness: 0.84,
      metalness: 0.18,
    })
    const cableMesh = new THREE.Mesh(cableGeo, cableMat)
    cableMesh.name = 'maze-env-cables'
    cableMesh.castShadow = false
    cableMesh.receiveShadow = false
    meshes.push(cableMesh)
  }

  return meshes
}

/**
 * Adds restrained distant facility markings onto select inner-ring concrete
 * pillars using the pooled graffiti atlas (zero extra texture allocation).
 */
function createDistantPillarMarkings(pillars, surfaceSet, tier, rng) {
  if (tier === 'performance' || !surfaceSet?.graffitiMaterial) return null

  const innerFacing = pillars.filter(
    (p) => p.ring === 0 && (p.inwardNx !== 0 || p.inwardNz !== 0)
  )
  if (innerFacing.length === 0) return null

  const selected = []
  const maxDecals = tier === 'high' ? 6 : 4
  for (let i = 0; i < innerFacing.length && selected.length < maxDecals; i += 2) {
    selected.push(innerFacing[i])
  }
  if (selected.length === 0) return null

  const count = selected.length
  const positions = new Float32Array(count * 4 * 3)
  const normals = new Float32Array(count * 4 * 3)
  const uvs = new Float32Array(count * 4 * 2)
  const colors = new Float32Array(count * 4 * 4)
  const indices = new Uint16Array(count * 6)

  // Stencil, warning, and caution cells from the 3x3 graffiti atlas
  const atlasPickIndices = [0, 1, 2, 5, 7]

  for (let i = 0; i < count; i += 1) {
    const p = selected[i]
    const nx = p.inwardNx
    const nz = p.inwardNz
    // Tangent T chosen so T x +Y == N (matching CCW front-facing winding)
    const tx = nz
    const tz = -nx

    const faceOffset = p.width * 0.5 + 0.03
    const halfW = p.width * 0.38
    const halfH = halfW * 0.78
    const cy = 5.1 + rng() * 0.9

    const cx = p.x + nx * faceOffset
    const cz = p.z + nz * faceOffset

    const vBase = i * 4
    const corners = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ]
    for (let k = 0; k < 4; k += 1) {
      const [lx, ly] = corners[k]
      const vIdx = (vBase + k) * 3
      positions[vIdx] = cx + tx * lx
      positions[vIdx + 1] = cy + ly
      positions[vIdx + 2] = cz + tz * lx
      normals[vIdx] = nx
      normals[vIdx + 1] = 0
      normals[vIdx + 2] = nz

      const cIdx = (vBase + k) * 4
      colors[cIdx] = 0.9
      colors[cIdx + 1] = 0.92
      colors[cIdx + 2] = 0.95
      colors[cIdx + 3] = 0.84
    }

    const atlasIdx = atlasPickIndices[i % atlasPickIndices.length]
    const [u0, v0, u1, v1] = GRAFFITI_ATLAS_UVS[atlasIdx]
    const uvBase = vBase * 2
    uvs[uvBase] = u0
    uvs[uvBase + 1] = v0
    uvs[uvBase + 2] = u1
    uvs[uvBase + 3] = v0
    uvs[uvBase + 4] = u1
    uvs[uvBase + 5] = v1
    uvs[uvBase + 6] = u0
    uvs[uvBase + 7] = v1

    const iBase = i * 6
    indices[iBase] = vBase
    indices[iBase + 1] = vBase + 1
    indices[iBase + 2] = vBase + 2
    indices[iBase + 3] = vBase
    indices[iBase + 4] = vBase + 2
    indices[iBase + 5] = vBase + 3
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeBoundingBox()
  geo.computeBoundingSphere()

  const mesh = new THREE.Mesh(geo, surfaceSet.graffitiMaterial)
  mesh.name = 'maze-env-bg-markings'
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * Places occasional dim industrial bulkhead/warning fixtures on distant outer
 * pillars & high gantry cross-beams, with optional soft additive halo discs
 * and zero extra PointLights.
 */
function createDistantBeacons(pillars, innerSpanX, innerSpanZ, tier, rng) {
  const entries = []
  const maxPillarBeacons = tier === 'performance' ? 4 : tier === 'balanced' ? 6 : 8

  let placed = 0
  for (let i = 0; i < pillars.length && placed < maxPillarBeacons; i += 2) {
    const p = pillars[i]
    if (p.ring !== 0) continue
    const nx = p.inwardNx || -Math.sign(p.x)
    const nz = p.inwardNz || 0
    const normLen = Math.hypot(nx, nz) || 1
    const ux = nx / normLen
    const uz = nz / normLen
    const isWarningAmber = placed % 3 !== 2
    entries.push({
      x: p.x + ux * (p.width * 0.5 + 0.14),
      y: 7.45,
      z: p.z + uz * (p.width * 0.5 + 0.14),
      yaw: Math.atan2(ux, uz),
      isAmber: isWarningAmber,
      phase: rng() * Math.PI * 2,
      rate: 0.9 + rng() * 0.85,
      baseHex: isWarningAmber ? 0xb45309 : 0x4b749f,
      haloHex: isWarningAmber ? 0x7c3408 : 0x264361,
      flickerSlot: placed === 1,
    })
    placed += 1
  }

  if (tier !== 'performance') {
    const gantryPositions = [
      [-innerSpanX * 0.45, 11.92, -innerSpanZ * 0.58],
      [innerSpanX * 0.45, 11.92, innerSpanZ * 0.58],
    ]
    if (tier === 'high') {
      gantryPositions.push([innerSpanX * 0.45, 11.92, -innerSpanZ * 0.58])
      gantryPositions.push([-innerSpanX * 0.45, 11.92, innerSpanZ * 0.58])
    }
    for (let i = 0; i < gantryPositions.length; i += 1) {
      const [gx, gy, gz] = gantryPositions[i]
      const isAmber = i % 2 === 0
      entries.push({
        x: gx,
        y: gy,
        z: gz,
        yaw: Math.atan2(-gx, -gz),
        isAmber,
        phase: rng() * Math.PI * 2,
        rate: 0.75 + rng() * 0.65,
        baseHex: isAmber ? 0x9a440a : 0x3b6085,
        haloHex: isAmber ? 0x612806 : 0x1e364f,
        flickerSlot: false,
      })
    }
  }

  if (entries.length === 0) {
    return { meshes: [], controller: null }
  }

  const housingGeo = new THREE.BoxGeometry(0.46, 0.28, 0.24)
  const housingMat = new THREE.MeshStandardMaterial({
    color: 0x151e2b,
    roughness: 0.75,
    metalness: 0.5,
  })
  const housingMesh = new THREE.InstancedMesh(housingGeo, housingMat, entries.length)
  housingMesh.name = 'maze-env-beacon-housings'
  housingMesh.castShadow = false
  housingMesh.receiveShadow = false

  const bulbGeo = new THREE.BoxGeometry(0.32, 0.14, 0.16)
  const bulbMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: true,
    toneMapped: true,
  })
  const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, entries.length)
  bulbMesh.name = 'maze-env-beacon-bulbs'
  bulbMesh.castShadow = false
  bulbMesh.receiveShadow = false

  const dummy = new THREE.Object3D()
  const baseBulbColor = new THREE.Color()
  const baseHaloColor = new THREE.Color()

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]
    dummy.position.set(e.x, e.y, e.z)
    dummy.rotation.set(0, e.yaw, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    housingMesh.setMatrixAt(i, dummy.matrix)

    dummy.position.set(
      e.x + Math.sin(e.yaw) * 0.08,
      e.y,
      e.z + Math.cos(e.yaw) * 0.08
    )
    dummy.updateMatrix()
    bulbMesh.setMatrixAt(i, dummy.matrix)

    baseBulbColor.setHex(e.baseHex)
    bulbMesh.setColorAt(i, baseBulbColor)
  }

  housingMesh.instanceMatrix.needsUpdate = true
  housingMesh.computeBoundingBox()
  housingMesh.computeBoundingSphere()

  bulbMesh.instanceMatrix.needsUpdate = true
  if (bulbMesh.instanceColor) bulbMesh.instanceColor.needsUpdate = true
  bulbMesh.computeBoundingBox()
  bulbMesh.computeBoundingSphere()

  const meshes = [housingMesh, bulbMesh]

  let haloMesh = null
  if (tier !== 'performance') {
    const haloTex = getPooledAsset('beacon-halo-tex', createBeaconHaloTexture)
    const haloGeo = new THREE.PlaneGeometry(2.4, 2.4)
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: haloTex,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    })
    haloMesh = new THREE.InstancedMesh(haloGeo, haloMat, entries.length)
    haloMesh.name = 'maze-env-beacon-halos'
    haloMesh.castShadow = false
    haloMesh.receiveShadow = false

    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i]
      dummy.position.set(
        e.x + Math.sin(e.yaw) * 0.14,
        e.y,
        e.z + Math.cos(e.yaw) * 0.14
      )
      dummy.rotation.set(0, e.yaw, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      haloMesh.setMatrixAt(i, dummy.matrix)

      baseHaloColor.setHex(e.haloHex)
      haloMesh.setColorAt(i, baseHaloColor)
    }

    haloMesh.instanceMatrix.needsUpdate = true
    if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true
    haloMesh.computeBoundingBox()
    haloMesh.computeBoundingSphere()
    meshes.push(haloMesh)
  }

  const controller = {
    entries,
    bulbMesh,
    haloMesh,
    lastLightScale: 1,
  }

  return { meshes, controller }
}

/**
 * Updates dim distant industrial warning beacon modulation without allocating
 * per-frame objects. Respects Reduced Motion and syncs cleanly with lighting dips.
 */
export function updateUndergroundBackdrop(
  backdropGroup,
  elapsedSec = 0,
  { lightScale = 1, reducedMotion = false } = {}
) {
  const controller = backdropGroup?.userData?.beaconController
  if (!controller || !controller.bulbMesh) return

  const { entries, bulbMesh, haloMesh } = controller
  const safeScale = Math.max(0.08, Math.min(1.25, Number(lightScale) || 1))
  const t = Number.isFinite(elapsedSec) ? elapsedSec : 0

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]
    let pulse = 1
    if (!reducedMotion) {
      const slowWave = 0.72 + 0.28 * Math.sin(t * e.rate + e.phase)
      if (e.flickerSlot) {
        const sputter = Math.sin(t * 17.5 + e.phase) > 0.82 ? 0.32 : 1.0
        pulse = slowWave * sputter
      } else {
        pulse = slowWave
      }
    }

    const combined = pulse * safeScale
    _tmpColor.setHex(e.baseHex).multiplyScalar(combined)
    bulbMesh.setColorAt(i, _tmpColor)

    if (haloMesh) {
      _tmpColor.setHex(e.haloHex).multiplyScalar(combined)
      haloMesh.setColorAt(i, _tmpColor)
    }
  }

  if (bulbMesh.instanceColor) {
    bulbMesh.instanceColor.needsUpdate = true
  }
  if (haloMesh?.instanceColor) {
    haloMesh.instanceColor.needsUpdate = true
  }
}

/**
 * Builds the complete surrounding subterranean facility backdrop group:
 *  - Cavernous midnight-slate gradient sky dome matching scene.fog
 *  - Extended concrete sub-floor apron
 *  - Distant concrete support piers & corbel collars (instanced)
 *  - High-clearance overhead steel gantries, HVAC ducts & catenary cables
 *  - Restrained markings on distant piers + dim industrial warning beacons
 */
export function buildUndergroundBackdrop({
  span,
  backgroundColor = 0x0b111b,
  fogColor = 0x0b111b,
  qualityPreset = 'high',
} = {}) {
  const safeSpan = span || {
    rows: 11,
    cols: 11,
    width: 11 * CELL_SIZE,
    depth: 11 * CELL_SIZE,
  }
  const tier = normalizeBackdropQualityTier(qualityPreset)
  const rng = createRng(`underground-backdrop-${safeSpan.rows}x${safeSpan.cols}-${tier}`)
  const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset: tier })

  const group = new THREE.Group()
  group.name = 'maze-env-backdrop'

  const horizonHex = typeof fogColor === 'number' ? fogColor : backgroundColor
  const skyDome = createCavernSkyDome(safeSpan, horizonHex)
  group.add(skyDome)

  const apronFloor = createOuterApronFloor(safeSpan, surfaceSet)
  group.add(apronFloor)

  const backdropSeed = `underground-backdrop-${safeSpan.rows}x${safeSpan.cols}-${tier}`
  const { pillars, innerSpanX, innerSpanZ, outerSpanX, outerSpanZ } = collectPillarLayout(safeSpan, tier)
  const pillarMeshes = createOuterConcretePillars(pillars, surfaceSet, rng, backdropSeed, tier)
  for (let i = 0; i < pillarMeshes.length; i += 1) {
    group.add(pillarMeshes[i])
  }

  const vaultRoofMesh = createUpperCavernVaultRoof(
    innerSpanX,
    innerSpanZ,
    outerSpanX,
    outerSpanZ,
    surfaceSet,
    tier,
    backdropSeed
  )
  if (vaultRoofMesh) {
    group.add(vaultRoofMesh)
  }

  const overheadMeshes = createOverheadInfrastructure(
    safeSpan,
    innerSpanX,
    innerSpanZ,
    tier,
    rng
  )
  for (let i = 0; i < overheadMeshes.length; i += 1) {
    group.add(overheadMeshes[i])
  }

  const markingsMesh = createDistantPillarMarkings(pillars, surfaceSet, tier, rng)
  if (markingsMesh) {
    group.add(markingsMesh)
  }

  const { meshes: beaconMeshes, controller: beaconController } =
    createDistantBeacons(pillars, innerSpanX, innerSpanZ, tier, rng)
  for (let i = 0; i < beaconMeshes.length; i += 1) {
    group.add(beaconMeshes[i])
  }

  group.userData = {
    isUndergroundBackdrop: true,
    qualityTier: tier,
    skyDome,
    apronFloor,
    vaultRoofMesh,
    pillarCount: pillars.length,
    beaconCount: beaconController?.entries?.length || 0,
    beaconController,
  }

  return group
}

/**
 * Safely disposes all owned backdrop geometries and materials while preserving
 * pooled shared textures/materials managed by `sharedResources.js`.
 */
export function disposeUndergroundBackdrop(backdropGroup) {
  if (!backdropGroup) return false

  const disposedGeos = new Set()
  const disposedMats = new Set()

  backdropGroup.traverse((node) => {
    if (node.geometry && !isSharedResource(node.geometry) && !disposedGeos.has(node.geometry)) {
      disposedGeos.add(node.geometry)
      node.geometry.dispose?.()
    }
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (let i = 0; i < mats.length; i += 1) {
        const mat = mats[i]
        if (mat && !isSharedResource(mat) && !disposedMats.has(mat)) {
          disposedMats.add(mat)
          mat.dispose?.()
        }
      }
    }
  })

  if (backdropGroup.parent) {
    backdropGroup.parent.remove(backdropGroup)
  }
  backdropGroup.clear()
  return true
}
