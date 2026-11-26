import * as THREE from 'three'
import {
  HIDING_SPOT_CONFIG,
  HIDING_SPOT_TYPES,
  isValidHidingSpotType,
} from '../mechanics/hidingConfig.js'
import {
  isSharedResource,
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

const PALETTE = {
  darkSteel: 0x28323e,
  midSteel: 0x3b4859,
  rustedIron: 0x453027,
  lockerBlue: 0x263847,
  oliveMetal: 0x2e3b34,
  copperBrass: 0x8a6537,
  ochreStripe: 0x9b7934,
  concreteDark: 0x222c3b,
  acousticDark: 0x161b22,
  heavyVinyl: 0x1b232c,
  canvasTarp: 0x2d352e,
  timberCrate: 0x4b392b,
  rubberPad: 0x14171c,
  indicatorReady: 0x2dd4bf,
  indicatorWarn: 0xf59e0b,
  indicatorDanger: 0xef4444,
}

const _hidingGeoPool = new Map()
const _hidingMatPool = new Map()

const NO_SHADOW_PART_PREFIXES = [
  'hiding-indicator',
  'pit-floor',
  'crawl-floor-mat',
  'locker-interior-liner',
  'locker-louver-top-',
  'locker-stencil-plate',
  'locker-handle',
  'locker-rail',
  'locker-top-shelf',
  'platform-foot-',
  'platform-deck-pad',
  'platform-edge-stripe',
  'ladder-rung-',
  'crawl-flange-',
  'crawl-pressure-gauge',
  'crawl-flap-stripe',
  'machinery-fin-',
  'machinery-flywheel-spoke-',
  'machinery-panel-latch',
  'alcove-flange-',
  'alcove-grab-',
  'alcove-threshold',
  'curtain-bracket-',
  'curtain-ring-',
  'curtain-weight-',
  'hatch-rung-',
  'hatch-warning-bar',
  'hatch-wheel-latch',
]

function isNonSilhouetteShadowDetail(name) {
  if (!name) return false
  for (let i = 0; i < NO_SHADOW_PART_PREFIXES.length; i += 1) {
    if (name.startsWith(NO_SHADOW_PART_PREFIXES[i])) return true
  }
  return false
}

function getPooledBoxGeo(w, h, d) {
  const key = `box:${w.toFixed(4)}:${h.toFixed(4)}:${d.toFixed(4)}`
  let geo = _hidingGeoPool.get(key)
  if (!geo) {
    geo = markSharedResource(new THREE.BoxGeometry(w, h, d))
    _hidingGeoPool.set(key, geo)
  }
  return geo
}

function getPooledCylGeo(rTop, rBot, h, segs) {
  const key = `cyl:${rTop.toFixed(4)}:${rBot.toFixed(4)}:${h.toFixed(4)}:${segs}`
  let geo = _hidingGeoPool.get(key)
  if (!geo) {
    geo = markSharedResource(new THREE.CylinderGeometry(rTop, rBot, h, segs))
    _hidingGeoPool.set(key, geo)
  }
  return geo
}

export function disposeHidingSpotPools() {
  for (const geo of _hidingGeoPool.values()) {
    geo?.dispose?.()
  }
  _hidingGeoPool.clear()
  for (const mat of _hidingMatPool.values()) {
    mat?.dispose?.()
  }
  _hidingMatPool.clear()
}

export function getHidingSpotPoolStats() {
  return {
    geometries: _hidingGeoPool.size,
    materials: _hidingMatPool.size,
  }
}

registerSharedPoolClearer(disposeHidingSpotPools)

function createMetalMat(color, roughness = 0.72, metalness = 0.58) {
  const key = `metal:${color}:${roughness.toFixed(3)}:${metalness.toFixed(3)}`
  let mat = _hidingMatPool.get(key)
  if (!mat) {
    mat = markSharedResource(
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        envMapIntensity: 0.45,
      })
    )
    _hidingMatPool.set(key, mat)
  }
  return mat
}

function createMatteMat(color, roughness = 0.9, metalness = 0.08) {
  const key = `matte:${color}:${roughness.toFixed(3)}:${metalness.toFixed(3)}`
  let mat = _hidingMatPool.get(key)
  if (!mat) {
    mat = markSharedResource(
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        envMapIntensity: 0.25,
      })
    )
    _hidingMatPool.set(key, mat)
  }
  return mat
}

function createEmissiveIndicatorMat(color = PALETTE.indicatorReady, intensity = 0.85) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.35,
    metalness: 0.15,
  })
}

function setShadowFlags(obj, cast = true, receive = true) {
  obj.castShadow = Boolean(cast)
  obj.receiveShadow = Boolean(receive)
  return obj
}

function addBoxPart(parent, w, h, d, x, y, z, mat, { name = '', castShadow = true, receiveShadow = true, rx = 0, ry = 0, rz = 0 } = {}) {
  const geo = getPooledBoxGeo(w, h, d)
  const mesh = new THREE.Mesh(geo, mat)
  if (name) mesh.name = name
  mesh.position.set(x, y, z)
  if (rx || ry || rz) mesh.rotation.set(rx, ry, rz)
  const detailSkip = !castShadow || isNonSilhouetteShadowDetail(name)
  if (detailSkip) {
    mesh.userData.noShadowCaster = true
  }
  setShadowFlags(mesh, !detailSkip, receiveShadow)
  parent.add(mesh)
  return mesh
}

function addCylPart(parent, rTop, rBot, h, segs, x, y, z, mat, { name = '', castShadow = true, receiveShadow = true, rx = 0, ry = 0, rz = 0 } = {}) {
  const geo = getPooledCylGeo(rTop, rBot, h, segs)
  const mesh = new THREE.Mesh(geo, mat)
  if (name) mesh.name = name
  mesh.position.set(x, y, z)
  if (rx || ry || rz) mesh.rotation.set(rx, ry, rz)
  const detailSkip = !castShadow || isNonSilhouetteShadowDetail(name)
  if (detailSkip) {
    mesh.userData.noShadowCaster = true
  }
  setShadowFlags(mesh, !detailSkip, receiveShadow)
  parent.add(mesh)
  return mesh
}

function buildMetalCupboard(root, userData) {
  const bodyMat = createMetalMat(PALETTE.lockerBlue, 0.68, 0.56)
  const trimMat = createMetalMat(PALETTE.darkSteel, 0.74, 0.62)
  const interiorMat = createMatteMat(PALETTE.acousticDark, 0.94, 0.1)
  const latchMat = createMetalMat(PALETTE.ochreStripe, 0.52, 0.65)
  const indicatorMat = createEmissiveIndicatorMat(PALETTE.indicatorReady, 0.9)

  // Outer cabinet box (open front +Z face)
  addBoxPart(root, 1.16, 2.02, 0.06, 0, 1.01, -0.28, bodyMat, { name: 'locker-back' })
  addBoxPart(root, 0.06, 2.02, 0.56, -0.55, 1.01, -0.02, bodyMat, { name: 'locker-left' })
  addBoxPart(root, 0.06, 2.02, 0.56, 0.55, 1.01, -0.02, bodyMat, { name: 'locker-right' })
  addBoxPart(root, 1.16, 0.06, 0.6, 0, 2.02, -0.01, trimMat, { name: 'locker-roof' })
  addBoxPart(root, 1.16, 0.08, 0.6, 0, 0.04, -0.01, trimMat, { name: 'locker-plinth' })
  addBoxPart(root, 1.02, 1.88, 0.04, 0, 0.99, -0.24, interiorMat, { name: 'locker-interior-liner', castShadow: false })

  // Internal coat bar & shelf
  addBoxPart(root, 1.02, 0.04, 0.44, 0, 1.72, -0.04, trimMat, { name: 'locker-top-shelf' })
  addCylPart(root, 0.018, 0.018, 0.98, 8, 0, 1.62, -0.05, trimMat, {
    name: 'locker-rail',
    rz: Math.PI / 2,
  })

  // Hinged louvered steel door
  const doorPivot = new THREE.Group()
  doorPivot.name = 'locker-door-pivot'
  doorPivot.position.set(-0.52, 1.01, 0.27)
  root.add(doorPivot)

  addBoxPart(doorPivot, 1.04, 1.88, 0.045, 0.52, 0, 0, bodyMat, { name: 'locker-door-leaf' })
  addBoxPart(doorPivot, 0.28, 0.14, 0.015, 0.52, 0.42, 0.028, latchMat, { name: 'locker-stencil-plate' })
  // Louver vents (peep/breath slits)
  for (let i = 0; i < 4; i += 1) {
    addBoxPart(doorPivot, 0.52, 0.035, 0.02, 0.52, 0.66 - i * 0.07, 0.024, trimMat, {
      name: `locker-louver-top-${i}`,
      rx: 0.35,
    })
  }
  addBoxPart(doorPivot, 0.045, 0.24, 0.05, 0.94, 0.02, 0.035, latchMat, { name: 'locker-handle' })
  const indicatorMesh = addBoxPart(doorPivot, 0.05, 0.05, 0.02, 0.94, 0.2, 0.03, indicatorMat, {
    name: 'hiding-indicator',
    castShadow: false,
  })

  userData.doorPivot = doorPivot
  userData.indicatorMesh = indicatorMesh
  userData.indicatorMat = indicatorMat
  userData.materials = [bodyMat, trimMat, interiorMat, latchMat, indicatorMat]
}

function buildElevatedPlatform(root, userData) {
  const frameMat = createMetalMat(PALETTE.darkSteel, 0.72, 0.65)
  const deckMat = createMetalMat(PALETTE.midSteel, 0.68, 0.52)
  const railMat = createMetalMat(PALETTE.ochreStripe, 0.6, 0.45)
  const rubberMat = createMatteMat(PALETTE.rubberPad, 0.92, 0.05)
  const indicatorMat = createEmissiveIndicatorMat(PALETTE.indicatorReady, 0.85)

  const deckY = 1.32
  // 4 angle-iron legs with bolted base plates
  const legCoords = [
    [-0.72, -0.44],
    [0.72, -0.44],
    [-0.72, 0.44],
    [0.72, 0.44],
  ]
  for (let i = 0; i < legCoords.length; i += 1) {
    const [lx, lz] = legCoords[i]
    addBoxPart(root, 0.08, deckY, 0.08, lx, deckY * 0.5, lz, frameMat, { name: `platform-leg-${i}` })
    addBoxPart(root, 0.18, 0.03, 0.18, lx, 0.015, lz, frameMat, { name: `platform-foot-${i}` })
  }

  // Structural cross-beams
  addBoxPart(root, 1.54, 0.09, 0.08, 0, deckY - 0.05, -0.44, frameMat, { name: 'platform-beam-back' })
  addBoxPart(root, 1.54, 0.09, 0.08, 0, deckY - 0.05, 0.44, frameMat, { name: 'platform-beam-front' })
  addBoxPart(root, 0.08, 0.09, 0.92, -0.72, deckY - 0.05, 0, frameMat, { name: 'platform-beam-left' })
  addBoxPart(root, 0.08, 0.09, 0.92, 0.72, deckY - 0.05, 0, frameMat, { name: 'platform-beam-right' })

  // Main deck + non-slip top mat + safety front lip
  addBoxPart(root, 1.58, 0.07, 0.98, 0, deckY, 0, deckMat, { name: 'platform-deck' })
  addBoxPart(root, 1.32, 0.02, 0.76, 0, deckY + 0.04, -0.02, rubberMat, { name: 'platform-deck-pad' })
  addBoxPart(root, 1.58, 0.06, 0.04, 0, deckY + 0.03, 0.49, railMat, { name: 'platform-edge-stripe' })

  // Guardrails (back & sides + partial left front guard)
  addBoxPart(root, 1.54, 0.04, 0.04, 0, deckY + 0.72, -0.46, railMat, { name: 'platform-rail-back' })
  addBoxPart(root, 0.04, 0.04, 0.92, -0.74, deckY + 0.72, 0, railMat, { name: 'platform-rail-left' })
  addBoxPart(root, 0.04, 0.04, 0.92, 0.74, deckY + 0.72, 0, railMat, { name: 'platform-rail-right' })
  addBoxPart(root, 0.05, 0.74, 0.05, -0.74, deckY + 0.37, 0.44, frameMat, { name: 'platform-post-fl' })
  addBoxPart(root, 0.05, 0.74, 0.05, 0.74, deckY + 0.37, 0.44, frameMat, { name: 'platform-post-fr' })

  // Angled front access ladder
  const ladderGroup = new THREE.Group()
  ladderGroup.name = 'platform-ladder'
  ladderGroup.position.set(0.32, 0, 0.56)
  ladderGroup.rotation.x = -0.18
  root.add(ladderGroup)
  addBoxPart(ladderGroup, 0.045, 1.42, 0.045, -0.22, 0.71, 0, frameMat, { name: 'ladder-rail-l' })
  addBoxPart(ladderGroup, 0.045, 1.42, 0.045, 0.22, 0.71, 0, frameMat, { name: 'ladder-rail-r' })
  for (let i = 0; i < 4; i += 1) {
    addCylPart(ladderGroup, 0.018, 0.018, 0.44, 8, 0, 0.26 + i * 0.3, 0, railMat, {
      name: `ladder-rung-${i}`,
      rz: Math.PI / 2,
    })
  }

  const indicatorMesh = addBoxPart(root, 0.08, 0.05, 0.04, -0.58, deckY - 0.05, 0.49, indicatorMat, {
    name: 'hiding-indicator',
    castShadow: false,
  })

  userData.ladderGroup = ladderGroup
  userData.indicatorMesh = indicatorMesh
  userData.indicatorMat = indicatorMat
  userData.materials = [frameMat, deckMat, railMat, rubberMat, indicatorMat]
}

function buildPipeCrawlspace(root, userData) {
  const pipeMat = createMetalMat(PALETTE.rustedIron, 0.74, 0.58)
  const shroudMat = createMetalMat(PALETTE.darkSteel, 0.7, 0.62)
  const brassMat = createMetalMat(PALETTE.copperBrass, 0.48, 0.78)
  const padMat = createMatteMat(PALETTE.rubberPad, 0.95, 0.04)
  const indicatorMat = createEmissiveIndicatorMat(PALETTE.indicatorReady, 0.85)

  // Left & right support stanchion frames leaving hollow under-pipe crawl bay
  addBoxPart(root, 0.14, 1.48, 0.76, -0.74, 0.74, -0.02, shroudMat, { name: 'crawl-frame-left' })
  addBoxPart(root, 0.14, 1.48, 0.76, 0.74, 0.74, -0.02, shroudMat, { name: 'crawl-frame-right' })
  addBoxPart(root, 1.62, 0.16, 0.82, 0, 1.42, -0.02, shroudMat, { name: 'crawl-hood-header' })
  addBoxPart(root, 1.28, 0.03, 0.7, 0, 0.015, 0.0, padMat, { name: 'crawl-floor-mat', castShadow: false })

  // Clustered overhead industrial conduits + flanges
  const pipeOffsets = [
    { y: 1.56, z: -0.2, r: 0.12 },
    { y: 1.58, z: 0.08, r: 0.14 },
    { y: 1.24, z: -0.26, r: 0.11 },
    { y: 1.82, z: -0.14, r: 0.09 },
  ]
  for (let i = 0; i < pipeOffsets.length; i += 1) {
    const p = pipeOffsets[i]
    addCylPart(root, p.r, p.r, 1.64, 12, 0, p.y, p.z, pipeMat, {
      name: `crawl-pipe-${i}`,
      rz: Math.PI / 2,
    })
    addCylPart(root, p.r * 1.26, p.r * 1.26, 0.06, 12, -0.52, p.y, p.z, shroudMat, {
      name: `crawl-flange-l-${i}`,
      rz: Math.PI / 2,
    })
    addCylPart(root, p.r * 1.26, p.r * 1.26, 0.06, 12, 0.52, p.y, p.z, shroudMat, {
      name: `crawl-flange-r-${i}`,
      rz: Math.PI / 2,
    })
  }

  // Brass valve wheel & gauge
  addCylPart(root, 0.09, 0.09, 0.04, 12, -0.45, 1.66, 0.24, brassMat, {
    name: 'crawl-pressure-gauge',
    rx: Math.PI / 2,
  })

  // Hinged front perforated flap that lifts on entry
  const flapPivot = new THREE.Group()
  flapPivot.name = 'crawl-flap-pivot'
  flapPivot.position.set(0, 1.32, 0.37)
  root.add(flapPivot)
  addBoxPart(flapPivot, 1.32, 0.38, 0.035, 0, -0.19, 0, shroudMat, { name: 'crawl-flap-plate' })
  addBoxPart(flapPivot, 1.26, 0.04, 0.04, 0, -0.36, 0.01, brassMat, { name: 'crawl-flap-stripe' })

  const indicatorMesh = addBoxPart(root, 0.07, 0.05, 0.04, 0.62, 1.22, 0.38, indicatorMat, {
    name: 'hiding-indicator',
    castShadow: false,
  })

  userData.doorPivot = flapPivot
  userData.indicatorMesh = indicatorMesh
  userData.indicatorMat = indicatorMat
  userData.materials = [pipeMat, shroudMat, brassMat, padMat, indicatorMat]
}

function buildMachineryHiding(root, userData) {
  const skidMat = createMetalMat(PALETTE.darkSteel, 0.78, 0.65)
  const housingMat = createMetalMat(PALETTE.oliveMetal, 0.66, 0.45)
  const copperMat = createMetalMat(PALETTE.copperBrass, 0.44, 0.8)
  const baffleMat = createMatteMat(PALETTE.acousticDark, 0.9, 0.14)
  const indicatorMat = createEmissiveIndicatorMat(PALETTE.indicatorReady, 0.85)

  // Heavy bolted base skid
  addBoxPart(root, 1.54, 0.12, 0.88, 0, 0.06, 0, skidMat, { name: 'machinery-skid' })

  // Main compressor turbine cylinder on left half
  addCylPart(root, 0.34, 0.34, 0.92, 16, -0.26, 0.76, -0.06, housingMat, {
    name: 'machinery-turbine-core',
    rz: Math.PI / 2,
  })
  // Cooling fin ribs
  for (let i = 0; i < 4; i += 1) {
    addBoxPart(root, 0.04, 0.76, 0.74, -0.58 + i * 0.2, 0.76, -0.06, skidMat, {
      name: `machinery-fin-${i}`,
    })
  }
  addBoxPart(root, 0.44, 0.56, 0.52, -0.45, 1.32, -0.14, skidMat, { name: 'machinery-hopper' })

  // Rotating flywheel at left end
  const flywheelPivot = new THREE.Group()
  flywheelPivot.name = 'machinery-flywheel-pivot'
  flywheelPivot.position.set(-0.74, 0.76, -0.06)
  root.add(flywheelPivot)
  addCylPart(flywheelPivot, 0.28, 0.28, 0.06, 16, 0, 0, 0, copperMat, {
    name: 'machinery-flywheel-rim',
    rz: Math.PI / 2,
  })
  addBoxPart(flywheelPivot, 0.08, 0.48, 0.05, 0, 0, 0, skidMat, { name: 'machinery-flywheel-spoke-a' })
  addBoxPart(flywheelPivot, 0.08, 0.05, 0.48, 0, 0, 0, skidMat, { name: 'machinery-flywheel-spoke-b' })

  // Recessed acoustic maintenance bay pocket on right side (+X)
  addBoxPart(root, 0.82, 1.66, 0.08, 0.32, 0.9, -0.36, baffleMat, { name: 'machinery-bay-back' })
  addBoxPart(root, 0.08, 1.66, 0.76, 0.72, 0.9, -0.02, housingMat, { name: 'machinery-bay-side' })
  addBoxPart(root, 0.86, 0.08, 0.82, 0.32, 1.72, -0.02, skidMat, { name: 'machinery-bay-roof' })

  // Hinged front inspection guard panel
  const panelPivot = new THREE.Group()
  panelPivot.name = 'machinery-panel-pivot'
  panelPivot.position.set(0.69, 0.88, 0.37)
  root.add(panelPivot)
  addBoxPart(panelPivot, 0.68, 1.48, 0.04, -0.34, 0, 0, housingMat, { name: 'machinery-door-panel' })
  addBoxPart(panelPivot, 0.22, 0.06, 0.05, -0.58, 0.08, 0.02, copperMat, { name: 'machinery-panel-latch' })

  const indicatorMesh = addBoxPart(root, 0.06, 0.06, 0.03, -0.05, 1.54, 0.36, indicatorMat, {
    name: 'hiding-indicator',
    castShadow: false,
  })

  userData.flywheelPivot = flywheelPivot
  userData.doorPivot = panelPivot
  userData.indicatorMesh = indicatorMesh
  userData.indicatorMat = indicatorMat
  userData.materials = [skidMat, housingMat, copperMat, baffleMat, indicatorMat]
}

function buildWallAlcove(root, userData) {
  const concreteMat = createMatteMat(PALETTE.concreteDark, 0.92, 0.08)
  const beamMat = createMetalMat(PALETTE.darkSteel, 0.72, 0.62)
  const padMat = createMatteMat(PALETTE.acousticDark, 0.95, 0.05)
  const grabMat = createMetalMat(PALETTE.copperBrass, 0.48, 0.7)
  const indicatorMat = createEmissiveIndicatorMat(PALETTE.indicatorReady, 0.8)

  // Deep steel & concrete shadow portal surround
  addBoxPart(root, 1.36, 2.26, 0.06, 0, 1.13, -0.2, padMat, { name: 'alcove-back-padding' })
  addBoxPart(root, 0.16, 2.3, 0.44, -0.66, 1.15, -0.01, concreteMat, { name: 'alcove-left-pillar' })
  addBoxPart(root, 0.16, 2.3, 0.44, 0.66, 1.15, -0.01, concreteMat, { name: 'alcove-right-pillar' })
  addBoxPart(root, 1.48, 0.22, 0.48, 0, 2.26, 0.0, beamMat, { name: 'alcove-lintel' })
  addBoxPart(root, 1.24, 0.04, 0.42, 0, 0.02, -0.01, beamMat, { name: 'alcove-threshold' })

  // Internal side steel I-flanges & grab handles
  addBoxPart(root, 0.05, 2.08, 0.36, -0.56, 1.1, 0.01, beamMat, { name: 'alcove-flange-l' })
  addBoxPart(root, 0.05, 2.08, 0.36, 0.56, 1.1, 0.01, beamMat, { name: 'alcove-flange-r' })
  addCylPart(root, 0.02, 0.02, 0.72, 8, -0.48, 1.15, 0.12, grabMat, { name: 'alcove-grab-l' })
  addCylPart(root, 0.02, 0.02, 0.72, 8, 0.48, 1.15, 0.12, grabMat, { name: 'alcove-grab-r' })

  // Hooded overhead bulkhead light housing
  addBoxPart(root, 0.36, 0.1, 0.18, 0, 2.11, 0.14, beamMat, { name: 'alcove-hood' })
  const indicatorMesh = addBoxPart(root, 0.24, 0.04, 0.08, 0, 2.07, 0.14, indicatorMat, {
    name: 'hiding-indicator',
    castShadow: false,
  })

  userData.indicatorMesh = indicatorMesh
  userData.indicatorMat = indicatorMat
  userData.materials = [concreteMat, beamMat, padMat, grabMat, indicatorMat]
}

function buildHeavyIndustrialCurtains(root, userData) {
  const railMat = createMetalMat(PALETTE.midSteel, 0.65, 0.68)
  const grommetMat = createMetalMat(PALETTE.copperBrass, 0.45, 0.75)
  const vinylMat = createMatteMat(PALETTE.heavyVinyl, 0.86, 0.12)
  const vinylAltMat = createMatteMat(PALETTE.acousticDark, 0.9, 0.1)
  const weightMat = createMetalMat(PALETTE.darkSteel, 0.75, 0.6)
  const indicatorMat = createEmissiveIndicatorMat(PALETTE.indicatorReady, 0.82)

  // Overhead tubular gantry rail + end posts
  addBoxPart(root, 0.08, 2.26, 0.08, -0.76, 1.13, 0.12, railMat, { name: 'curtain-post-l' })
  addBoxPart(root, 0.08, 2.26, 0.08, 0.76, 1.13, 0.12, railMat, { name: 'curtain-post-r' })
  addBoxPart(root, 0.06, 0.06, 0.44, -0.76, 2.24, -0.06, railMat, { name: 'curtain-bracket-l' })
  addBoxPart(root, 0.06, 0.06, 0.44, 0.76, 2.24, -0.06, railMat, { name: 'curtain-bracket-r' })
  addCylPart(root, 0.032, 0.032, 1.62, 10, 0, 2.24, 0.18, railMat, {
    name: 'curtain-track-rod',
    rz: Math.PI / 2,
  })

  // 6 suspended weighted strip curtains along track
  const stripCount = 6
  const stripSpan = 1.44
  const stripWidth = 0.26
  const curtainStrips = []
  for (let i = 0; i < stripCount; i += 1) {
    const sx = -stripSpan * 0.5 + (i + 0.5) * (stripSpan / stripCount)
    const stripPivot = new THREE.Group()
    stripPivot.name = `curtain-strip-${i}`
    stripPivot.position.set(sx, 2.22, 0.18 + (i % 2 === 0 ? 0.012 : -0.012))
    stripPivot.userData = { baseX: sx, index: i, sideSign: i < stripCount / 2 ? -1 : 1 }
    root.add(stripPivot)

    addCylPart(stripPivot, 0.042, 0.042, 0.04, 8, 0, 0, 0, grommetMat, {
      name: `curtain-ring-${i}`,
      rz: Math.PI / 2,
    })
    addBoxPart(
      stripPivot,
      stripWidth,
      2.06,
      0.024,
      0,
      -1.06,
      0,
      i % 2 === 0 ? vinylMat : vinylAltMat,
      { name: `curtain-panel-${i}` }
    )
    addBoxPart(stripPivot, stripWidth * 0.96, 0.05, 0.032, 0, -2.07, 0, weightMat, {
      name: `curtain-weight-${i}`,
    })
    curtainStrips.push(stripPivot)
  }

  const indicatorMesh = addBoxPart(root, 0.06, 0.06, 0.06, -0.76, 1.95, 0.18, indicatorMat, {
    name: 'hiding-indicator',
    castShadow: false,
  })

  userData.curtainStrips = curtainStrips
  userData.indicatorMesh = indicatorMesh
  userData.indicatorMat = indicatorMat
  userData.materials = [railMat, grommetMat, vinylMat, vinylAltMat, weightMat, indicatorMat]
}

function buildFloorHatch(root, userData) {
  const coamingMat = createMetalMat(PALETTE.darkSteel, 0.72, 0.65)
  const lidMat = createMetalMat(PALETTE.midSteel, 0.64, 0.6)
  const stripeMat = createMetalMat(PALETTE.ochreStripe, 0.58, 0.42)
  const pitMat = createMatteMat(PALETTE.concreteDark, 0.94, 0.08)
  const ladderMat = createMetalMat(PALETTE.copperBrass, 0.55, 0.68)
  const indicatorMat = createEmissiveIndicatorMat(PALETTE.indicatorReady, 0.85)

  // Raised steel coaming collar frame around cut-out pit (1.12m inner opening)
  addBoxPart(root, 1.28, 0.12, 0.09, 0, 0.06, -0.59, coamingMat, { name: 'hatch-collar-back' })
  addBoxPart(root, 1.28, 0.12, 0.09, 0, 0.06, 0.59, coamingMat, { name: 'hatch-collar-front' })
  addBoxPart(root, 0.09, 0.12, 1.12, -0.59, 0.06, 0, coamingMat, { name: 'hatch-collar-left' })
  addBoxPart(root, 0.09, 0.12, 1.12, 0.59, 0.06, 0, coamingMat, { name: 'hatch-collar-right' })

  // Recessed maintenance pit shaft walls & sub-floor (-1.28m deep)
  addBoxPart(root, 1.14, 1.28, 0.06, 0, -0.64, -0.56, pitMat, { name: 'pit-wall-back' })
  addBoxPart(root, 1.14, 1.28, 0.06, 0, -0.64, 0.56, pitMat, { name: 'pit-wall-front' })
  addBoxPart(root, 0.06, 1.28, 1.12, -0.56, -0.64, 0, pitMat, { name: 'pit-wall-left' })
  addBoxPart(root, 0.06, 1.28, 1.12, 0.56, -0.64, 0, pitMat, { name: 'pit-wall-right' })
  addBoxPart(root, 1.18, 0.08, 1.18, 0, -1.28, 0, pitMat, { name: 'pit-floor', castShadow: false })

  // Sub-floor vertical descent ladder
  const ladderGroup = new THREE.Group()
  ladderGroup.name = 'hatch-ladder'
  ladderGroup.position.set(0, 0, -0.45)
  root.add(ladderGroup)
  addBoxPart(ladderGroup, 0.04, 1.22, 0.04, -0.19, -0.61, 0, coamingMat, { name: 'hatch-rail-l' })
  addBoxPart(ladderGroup, 0.04, 1.22, 0.04, 0.19, -0.61, 0, coamingMat, { name: 'hatch-rail-r' })
  for (let i = 0; i < 4; i += 1) {
    addCylPart(ladderGroup, 0.016, 0.016, 0.38, 8, 0, -0.22 - i * 0.28, 0, ladderMat, {
      name: `hatch-rung-${i}`,
      rz: Math.PI / 2,
    })
  }

  // Hinged diamond-plate hatch lid with wheel handle
  const hatchLidPivot = new THREE.Group()
  hatchLidPivot.name = 'hatch-lid-pivot'
  hatchLidPivot.position.set(0, 0.12, -0.55)
  root.add(hatchLidPivot)
  addBoxPart(hatchLidPivot, 1.14, 0.045, 1.14, 0, 0.022, 0.55, lidMat, { name: 'hatch-lid-plate' })
  addBoxPart(hatchLidPivot, 1.06, 0.015, 0.08, 0, 0.05, 1.04, stripeMat, { name: 'hatch-warning-bar' })
  addCylPart(hatchLidPivot, 0.12, 0.12, 0.03, 12, 0, 0.07, 0.72, ladderMat, { name: 'hatch-wheel-latch' })

  const indicatorMesh = addBoxPart(root, 0.09, 0.04, 0.04, 0.45, 0.1, 0.62, indicatorMat, {
    name: 'hiding-indicator',
    castShadow: false,
  })

  userData.hatchLidPivot = hatchLidPivot
  userData.ladderGroup = ladderGroup
  userData.indicatorMesh = indicatorMesh
  userData.indicatorMat = indicatorMat
  userData.materials = [coamingMat, lidMat, stripeMat, pitMat, ladderMat, indicatorMat]
}

function buildStorageShelves(root, userData) {
  const frameMat = createMetalMat(PALETTE.darkSteel, 0.74, 0.62)
  const shelfMat = createMetalMat(PALETTE.midSteel, 0.76, 0.5)
  const crateMat = createMatteMat(PALETTE.timberCrate, 0.9, 0.05)
  const drumMat = createMetalMat(PALETTE.rustedIron, 0.78, 0.48)
  const tarpMat = createMatteMat(PALETTE.canvasTarp, 0.92, 0.06)
  const indicatorMat = createEmissiveIndicatorMat(PALETTE.indicatorReady, 0.85)

  // 4 slotted angle uprights (height 2.16m)
  const xs = [-0.76, 0.76]
  const zs = [-0.34, 0.34]
  for (let xi = 0; xi < xs.length; xi += 1) {
    for (let zi = 0; zi < zs.length; zi += 1) {
      addBoxPart(root, 0.06, 2.16, 0.06, xs[xi], 1.08, zs[zi], frameMat, {
        name: `shelf-post-${xi}-${zi}`,
      })
    }
  }

  // Shelf decks (keeping lower bay y < 1.32 hollow for crouched hiding pocket!)
  addBoxPart(root, 1.56, 0.05, 0.72, 0, 1.32, 0, shelfMat, { name: 'shelf-deck-mid' })
  addBoxPart(root, 1.56, 0.05, 0.72, 0, 2.08, 0, shelfMat, { name: 'shelf-deck-top' })

  // Crates and drums on middle & top shelves + left flanking drum
  addBoxPart(root, 0.44, 0.44, 0.44, -0.44, 1.56, -0.02, crateMat, { name: 'shelf-crate-mid-l' })
  addBoxPart(root, 0.38, 0.34, 0.38, 0.48, 1.51, 0.02, crateMat, { name: 'shelf-crate-mid-r', ry: 0.14 })
  addCylPart(root, 0.16, 0.16, 0.52, 12, -0.58, 0.26, 0.12, drumMat, { name: 'shelf-drum-floor-l' })
  addBoxPart(root, 0.36, 0.42, 0.38, 0.58, 0.21, 0.1, crateMat, { name: 'shelf-crate-floor-r' })
  addBoxPart(root, 0.52, 0.32, 0.42, 0.08, 2.26, -0.04, crateMat, { name: 'shelf-crate-top' })

  // Suspended tarpaulin drop flap covering the front crouch bay
  const tarpPivot = new THREE.Group()
  tarpPivot.name = 'shelf-tarp-pivot'
  tarpPivot.position.set(0, 1.3, 0.36)
  root.add(tarpPivot)
  addBoxPart(tarpPivot, 0.96, 1.08, 0.025, 0, -0.54, 0, tarpMat, { name: 'shelf-tarp-flap' })

  const indicatorMesh = addBoxPart(root, 0.06, 0.05, 0.04, -0.76, 1.24, 0.36, indicatorMat, {
    name: 'hiding-indicator',
    castShadow: false,
  })

  userData.doorPivot = tarpPivot
  userData.indicatorMesh = indicatorMesh
  userData.indicatorMat = indicatorMat
  userData.materials = [frameMat, shelfMat, crateMat, drumMat, tarpMat, indicatorMat]
}

const BUILDERS = {
  [HIDING_SPOT_TYPES.METAL_CUPBOARD]: buildMetalCupboard,
  [HIDING_SPOT_TYPES.ELEVATED_PLATFORM]: buildElevatedPlatform,
  [HIDING_SPOT_TYPES.PIPE_CRAWLSPACE]: buildPipeCrawlspace,
  [HIDING_SPOT_TYPES.MACHINERY_HIDING]: buildMachineryHiding,
  [HIDING_SPOT_TYPES.WALL_ALCOVE]: buildWallAlcove,
  [HIDING_SPOT_TYPES.HEAVY_INDUSTRIAL_CURTAINS]: buildHeavyIndustrialCurtains,
  [HIDING_SPOT_TYPES.FLOOR_HATCH]: buildFloorHatch,
  [HIDING_SPOT_TYPES.STORAGE_SHELVES]: buildStorageShelves,
}

/**
 * Builds an industrial 3D composite Group for one of the 8 hiding spot types.
 */
export function buildHidingSpotMesh(spec = {}, options = {}) {
  const type = spec?.type
  if (!isValidHidingSpotType(type)) {
    throw new Error(`Unsupported hiding spot type: ${type}`)
  }

  const root = new THREE.Group()
  root.name = `hiding-spot-${spec.id || type}`
  root.position.set(
    Number.isFinite(spec.x) ? spec.x : 0,
    Number.isFinite(spec.y) ? spec.y : 0,
    Number.isFinite(spec.z) ? spec.z : 0
  )
  root.rotation.y = Number.isFinite(spec.wallYaw) ? spec.wallYaw : 0

  const cfg = HIDING_SPOT_CONFIG[type]
  const userData = {
    hidingSpotId: spec.id || null,
    hidingSpotType: type,
    label: cfg.label,
    wallYaw: root.rotation.y,
    halfWidth: cfg.placement.halfWidth,
    halfDepth: (cfg.placement.halfDepthBack + cfg.placement.halfDepthFront) * 0.5,
    enclosure: cfg.enclosure,
    materials: [],
    doorPivot: null,
    hatchLidPivot: null,
    flywheelPivot: null,
    curtainStrips: null,
    ladderGroup: null,
    indicatorMesh: null,
    indicatorMat: null,
  }

  BUILDERS[type](root, userData)
  root.userData = userData

  if (options?.qualityPreset) {
    syncHidingSpotQuality(root, options.qualityPreset)
  }

  return root
}

/**
 * Animates per-type mechanical doors, curtains, hatch lids, flywheels, and
 * indicator lights based on runtime hiding state.
 */
export function updateHidingSpotVisualState(
  root,
  {
    openProgress = 0,
    occupied = false,
    warning = false,
    compromised = false,
    swayPhase = 0,
    swayAmp = 0,
    flywheelAngle = 0,
    reducedMotion = false,
  } = {}
) {
  if (!root?.userData) return
  const ud = root.userData
  const type = ud.hidingSpotType

  if (ud.doorPivot) {
    if (type === HIDING_SPOT_TYPES.METAL_CUPBOARD) {
      ud.doorPivot.rotation.y = -openProgress * 1.48
    } else if (type === HIDING_SPOT_TYPES.PIPE_CRAWLSPACE) {
      ud.doorPivot.rotation.x = -openProgress * 1.05
    } else if (type === HIDING_SPOT_TYPES.MACHINERY_HIDING) {
      ud.doorPivot.rotation.y = openProgress * 1.38
    } else if (type === HIDING_SPOT_TYPES.STORAGE_SHELVES) {
      ud.doorPivot.rotation.x = -openProgress * 0.92
    }
  }

  if (ud.hatchLidPivot) {
    ud.hatchLidPivot.rotation.x = -openProgress * 1.42
  }

  if (ud.flywheelPivot) {
    ud.flywheelPivot.rotation.x = reducedMotion ? 0 : flywheelAngle
  }

  if (Array.isArray(ud.curtainStrips)) {
    const scale = reducedMotion ? 0.25 : 1.0
    for (let i = 0; i < ud.curtainStrips.length; i += 1) {
      const strip = ud.curtainStrips[i]
      const sideSign = strip.userData?.sideSign || 1
      const partAngle = openProgress * 0.42 * sideSign
      const draft =
        (swayAmp * 0.35 + (occupied ? 0.04 : 0.015)) *
        scale *
        Math.sin(swayPhase + i * 0.85)
      strip.rotation.z = partAngle + draft * 0.4
      strip.rotation.x = (openProgress * 0.28 + draft) * (i % 2 === 0 ? 1 : -0.6)
    }
  }

  if (ud.indicatorMat) {
    const targetHex = compromised
      ? PALETTE.indicatorDanger
      : warning
        ? PALETTE.indicatorWarn
        : PALETTE.indicatorReady
    const targetIntensity = compromised ? 1.35 : warning ? 1.15 : occupied ? 0.45 : 0.85
    if (ud._lastIndicatorHex !== targetHex) {
      ud.indicatorMat.color?.setHex(targetHex)
      ud.indicatorMat.emissive?.setHex(targetHex)
      ud._lastIndicatorHex = targetHex
    }
    if (ud._lastIndicatorIntensity !== targetIntensity) {
      ud.indicatorMat.emissiveIntensity = targetIntensity
      ud._lastIndicatorIntensity = targetIntensity
    }
  }
}

export function syncHidingSpotQuality(root, qualityPreset = 'high') {
  if (!root) return false
  const allowCast = qualityPreset !== 'performance'
  root.traverse?.((node) => {
    if (node.isMesh && node.name !== 'hiding-indicator') {
      node.castShadow =
        allowCast &&
        !node.userData?.noShadowCaster &&
        node.name !== 'pit-floor' &&
        node.name !== 'crawl-floor-mat'
    }
  })
  return true
}

export function disposeHidingSpotMesh(root) {
  if (!root) return false
  const disposedGeos = new Set()
  const disposedMats = new Set()

  root.traverse?.((node) => {
    if (
      node.geometry &&
      !isSharedResource(node.geometry) &&
      !disposedGeos.has(node.geometry)
    ) {
      disposedGeos.add(node.geometry)
      node.geometry.dispose?.()
    }
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (let i = 0; i < mats.length; i += 1) {
        const m = mats[i]
        if (m && !isSharedResource(m) && !disposedMats.has(m)) {
          disposedMats.add(m)
          m.dispose?.()
        }
      }
    }
  })

  if (root.parent) {
    root.parent.remove(root)
  }
  root.clear?.()
  return true
}
