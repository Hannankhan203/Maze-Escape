import * as THREE from 'three'
import { createRng } from '../../utils/rng.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { gridToWorld } from '../world/worldCoords.js'
import { getGalvanizedMetalTextureSet } from './buildCeilingVents.js'
import {
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'
import {
  bucketItemsByChunk,
  buildChunkedInstancedLayerNode,
  buildChunkedLayerNode,
  createMazeChunkLayout,
  getLayerMeshes,
  shouldChunkLayer,
} from './spatialChunking.js'
import {
  FACE_BOT,
  FACE_NEG_X,
  FACE_NEG_Z,
  FACE_POS_X,
  FACE_POS_Z,
  FACE_TOP,
  buildMergedBoxesWithCulling,
  countKeptBoxTriangles,
} from './geometryOptimization.js'

const lightAssetPool = new Map()

export const CEILING_LIGHT_CLEARANCE_MIN_Y = 3.3

export const CEILING_LIGHT_TYPES = [
  'recessed_panel',
  'cage_bulkhead',
  'fluorescent_batten',
]

export const CEILING_LIGHT_STATES = {
  WORKING: 'working',
  FLICKERING: 'flickering',
  BURNED_OUT: 'burned_out',
}

export const CEILING_LIGHT_PALETTE = {
  housingMetal: 0x303945, // Aged oxidized industrial housing steel
  workingEmissive: 0xcbe2f5, // Default cool-white fluorescent glow
  battenEmissive: 0xc4e3fb, // Crisp industrial cool daylight tube
  panelEmissive: 0xd7e4f2, // Neutral utility recessed diffuser
  bulkheadEmissive: 0xe6c18e, // Warm aged tungsten-amber caged bulkhead
  flickerTint: 0xd9a86c, // Subtle warm-amber failing ballast shift
  burnedOutGlass: 0x10151d, // Darkened matte smoked dead glass
  pointLightColor: 0xc6dff5, // Cool restrained overhead pool illumination
  spotLightColor: 0xd2e6f7, // Directional downward beam cone tint
}

const _tmpColor = new THREE.Color()
const _tmpColorDim = new THREE.Color()
const _tmpColorFlicker = new THREE.Color(CEILING_LIGHT_PALETTE.flickerTint)
const INSTANCE_COLOR_EPSILON = 1e-5

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function getPooledLightTexture(key, factory) {
  let asset = lightAssetPool.get(key)
  if (!asset) {
    asset = markSharedResource(factory())
    lightAssetPool.set(key, asset)
  }
  return asset
}

/**
 * Generates a soft square-compatible radial glow texture for optional overhead
 * diffuser halos (no harsh hard edges, restrained luminance).
 */
function createDiffuserHaloTexture() {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let py = 0; py < size; py += 1) {
    const ny = ((py + 0.5) / size) * 2 - 1
    for (let px = 0; px < size; px += 1) {
      const nx = ((px + 0.5) / size) * 2 - 1
      const dist = Math.hypot(nx, ny)
      const falloff = Math.max(0, 1 - dist)
      const alpha = Math.pow(falloff, 2.4)
      const off = (py * size + px) * 4
      data[off] = 225
      data[off + 1] = 240
      data[off + 2] = 255
      data[off + 3] = Math.round(alpha * 255)
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

export function disposeCeilingLightPools() {
  for (const asset of lightAssetPool.values()) {
    asset?.dispose?.()
  }
  lightAssetPool.clear()
}

export function getCeilingLightPoolStats() {
  return {
    entries: lightAssetPool.size,
  }
}

registerSharedPoolClearer(disposeCeilingLightPools)

/**
 * Merges static axis-aligned / oriented box parts (`rx`, `ry`, `rz`) for all fixture housings,
 * mounting brackets, bezels, angled reflector wings, and protective wire cages into a single BufferGeometry.
 */
function buildMergedFixtureHousingsGeometry(boxes, tileUnits = 1.6) {
  return buildMergedBoxesWithCulling(boxes, {
    tileUnits,
    worldTileUVs: false,
    storeBoxBounds: true,
  })
}

function appendFixtureGeometry({
  fixture,
  soffitY,
  housingBoxes,
  diffuserEntries,
  rng,
}) {
  const { x, z, designType, condition, yaw90 } = fixture
  const isBurnedOut = condition === CEILING_LIGHT_STATES.BURNED_OUT
  const rustTint = isBurnedOut
    ? [0.84, 0.76, 0.7]
    : [0.88 + (rng() - 0.5) * 0.06, 0.88, 0.89]

  if (designType === 'recessed_panel') {
    const sx = yaw90 ? 0.46 : 0.82
    const sz = yaw90 ? 0.82 : 0.46
    const panH = 0.068
    const panCy = soffitY - panH * 0.5

    // Upper recessed steel housing pan bolted to soffit (flush top face culled)
    housingBoxes.push({
      cx: x,
      cy: panCy,
      cz: z,
      sx,
      sy: panH,
      sz,
      r: rustTint[0],
      g: rustTint[1],
      b: rustTint[2],
      cullFaces: FACE_TOP,
    })

    // Flanged outer trim bezel strips around recessed diffuser + twin divider ribs
    const rim = 0.045
    const bezelY = soffitY - 0.072
    housingBoxes.push(
      { cx: x, cy: bezelY, cz: z - sz * 0.5 + rim * 0.5, sx: sx + 0.045, sy: 0.024, sz: rim, r: rustTint[0] * 0.92, g: rustTint[1] * 0.92, b: rustTint[2] * 0.92 },
      { cx: x, cy: bezelY, cz: z + sz * 0.5 - rim * 0.5, sx: sx + 0.045, sy: 0.024, sz: rim, r: rustTint[0] * 0.92, g: rustTint[1] * 0.92, b: rustTint[2] * 0.92 },
      { cx: x - sx * 0.5 + rim * 0.5, cy: bezelY, cz: z, sx: rim, sy: 0.024, sz: sz - rim * 2, r: rustTint[0] * 0.92, g: rustTint[1] * 0.92, b: rustTint[2] * 0.92, cullFaces: FACE_POS_Z | FACE_NEG_Z },
      { cx: x + sx * 0.5 - rim * 0.5, cy: bezelY, cz: z, sx: rim, sy: 0.024, sz: sz - rim * 2, r: rustTint[0] * 0.92, g: rustTint[1] * 0.92, b: rustTint[2] * 0.92, cullFaces: FACE_POS_Z | FACE_NEG_Z }
    )
    // Twin dust-catching louver cross-bars across diffuser face (ends butt flush inside bezel strips)
    for (const barOff of [-0.14, 0.14]) {
      housingBoxes.push({
        cx: x + (yaw90 ? 0 : barOff),
        cy: bezelY - 0.005,
        cz: z + (yaw90 ? barOff : 0),
        sx: yaw90 ? sx - rim * 2 : 0.022,
        sy: 0.016,
        sz: yaw90 ? 0.022 : sz - rim * 2,
        r: 0.78,
        g: 0.77,
        b: 0.75,
        cullFaces: yaw90 ? FACE_POS_X | FACE_NEG_X : FACE_POS_Z | FACE_NEG_Z,
      })
    }

    diffuserEntries.push({
      fixtureIndex: fixture.index,
      cx: x,
      cy: soffitY - 0.06,
      cz: z,
      sx: sx - rim * 1.9,
      sy: 0.02,
      sz: sz - rim * 1.9,
      ry: 0,
    })
    return {
      minY: soffitY - 0.09,
      lightY: soffitY - 0.145, // Strictly below bezel/louvers so spot doesn't self-shadow
      sx: sx + 0.045,
      sz: sz + 0.045,
      haloW: sx * 1.45,
      haloD: sz * 1.45,
    }
  }

  if (designType === 'cage_bulkhead') {
    const sx = yaw90 ? 0.28 : 0.38
    const sz = yaw90 ? 0.38 : 0.28
    const baseCy = soffitY - 0.03

    // Heavy cast bulkhead mounting plate + perimeter rubber gasket collar + side EMT entry boss
    housingBoxes.push(
      {
        cx: x,
        cy: baseCy,
        cz: z,
        sx: sx + 0.05,
        sy: 0.056,
        sz: sz + 0.05,
        r: rustTint[0] * 0.9,
        g: rustTint[1] * 0.88,
        b: rustTint[2] * 0.86,
        cullFaces: FACE_TOP,
      },
      {
        cx: x,
        cy: soffitY - 0.064,
        cz: z,
        sx: sx + 0.02,
        sy: 0.016,
        sz: sz + 0.02,
        r: 0.65,
        g: 0.66,
        b: 0.68,
        cullFaces: FACE_TOP,
      },
      {
        cx: x + (yaw90 ? 0 : sx * 0.5 + 0.03),
        cy: baseCy,
        cz: z + (yaw90 ? sz * 0.5 + 0.03 : 0),
        sx: 0.042,
        sy: 0.042,
        sz: 0.042,
        r: 0.8,
        g: 0.8,
        b: 0.82,
        cullFaces: yaw90 ? FACE_NEG_Z : FACE_NEG_X,
      }
    )

    // Protective wire cage guard bars framing glass diffuser
    const cageY = soffitY - 0.142
    const barThick = 0.018
    housingBoxes.push(
      { cx: x, cy: cageY, cz: z - sz * 0.26, sx: sx + 0.03, sy: barThick, sz: barThick, r: 0.72, g: 0.69, b: 0.66 },
      { cx: x, cy: cageY, cz: z + sz * 0.26, sx: sx + 0.03, sy: barThick, sz: barThick, r: 0.72, g: 0.69, b: 0.66 },
      { cx: x - sx * 0.24, cy: cageY - 0.004, cz: z, sx: barThick, sy: barThick, sz: sz + 0.02, r: 0.72, g: 0.69, b: 0.66 },
      { cx: x + sx * 0.24, cy: cageY - 0.004, cz: z, sx: barThick, sy: barThick, sz: sz + 0.02, r: 0.72, g: 0.69, b: 0.66 },
      // End & side cage risers tying upward inside bulkhead mounting plate
      { cx: x - sx * 0.48, cy: soffitY - 0.098, cz: z, sx: barThick, sy: 0.096, sz: sz * 0.76, r: 0.74, g: 0.71, b: 0.68, cullFaces: FACE_TOP },
      { cx: x + sx * 0.48, cy: soffitY - 0.098, cz: z, sx: barThick, sy: 0.096, sz: sz * 0.76, r: 0.74, g: 0.71, b: 0.68, cullFaces: FACE_TOP }
    )

    diffuserEntries.push({
      fixtureIndex: fixture.index,
      cx: x,
      cy: soffitY - 0.092,
      cz: z,
      sx: sx * 0.76,
      sy: 0.064,
      sz: sz * 0.72,
      ry: 0,
    })
    return {
      minY: soffitY - 0.16,
      lightY: soffitY - 0.21, // Strictly below cage bars so spot casts environmental shadows cleanly
      sx: sx + 0.06,
      sz: sz + 0.06,
      haloW: sx * 1.9,
      haloD: sz * 1.9,
    }
  }

  // Type 3: fluorescent_batten (suspended twin-tube angled reflector hood with canopy stems)
  const len = 1.18
  const wid = 0.22
  const sx = yaw90 ? wid : len
  const sz = yaw90 ? len : wid
  const hoodCy = soffitY - 0.145
  const stemOff = len * 0.34

  // Rigid top ceiling stems & soffit escutcheon canopies (y = 3.47 .. 3.60m)
  for (const s of [-1, 1]) {
    const cxStem = x + (yaw90 ? 0 : s * stemOff)
    const czStem = z + (yaw90 ? s * stemOff : 0)
    housingBoxes.push(
      {
        cx: cxStem,
        cy: soffitY - 0.055,
        cz: czStem,
        sx: 0.036,
        sy: 0.11,
        sz: 0.036,
        r: 0.76,
        g: 0.76,
        b: 0.78,
        cullFaces: FACE_TOP | FACE_BOT,
      },
      {
        cx: cxStem,
        cy: soffitY - 0.01,
        cz: czStem,
        sx: 0.105,
        sy: 0.02,
        sz: 0.105,
        r: 0.8,
        g: 0.79,
        b: 0.78,
        cullFaces: FACE_TOP,
      }
    )
  }

  // Central ballast channel box & top spine
  housingBoxes.push(
    {
      cx: x,
      cy: hoodCy + 0.022,
      cz: z,
      sx,
      sy: 0.048,
      sz,
      r: rustTint[0],
      g: rustTint[1],
      b: rustTint[2],
    },
    {
      cx: x,
      cy: hoodCy + 0.054,
      cz: z,
      sx: yaw90 ? 0.11 : 0.36,
      sy: 0.028,
      sz: yaw90 ? 0.36 : 0.11,
      r: rustTint[0] * 0.9,
      g: rustTint[1] * 0.9,
      b: rustTint[2] * 0.9,
      cullFaces: FACE_BOT,
    }
  )

  // Angled left/right industrial reflector wing skirts (spread light cleanly downward)
  const wingTilt = 0.42
  for (const ws of [-1, 1]) {
    housingBoxes.push({
      cx: x + (yaw90 ? ws * (wid * 0.5 + 0.024) : 0),
      cy: hoodCy + 0.002,
      cz: z + (yaw90 ? 0 : ws * (wid * 0.5 + 0.024)),
      sx: yaw90 ? 0.068 : len,
      sy: 0.014,
      sz: yaw90 ? len : 0.068,
      rx: yaw90 ? 0 : -ws * wingTilt,
      rz: yaw90 ? ws * wingTilt : 0,
      r: rustTint[0] * 0.95,
      g: rustTint[1] * 0.95,
      b: rustTint[2] * 0.96,
    })
  }

  // End tombstone socket caps (top face sits flush inside ballast channel underside)
  for (const s of [-1, 1]) {
    housingBoxes.push({
      cx: x + (yaw90 ? 0 : s * (len * 0.5 - 0.024)),
      cy: hoodCy - 0.024,
      cz: z + (yaw90 ? s * (len * 0.5 - 0.024) : 0),
      sx: yaw90 ? wid * 0.86 : 0.044,
      sy: 0.052,
      sz: yaw90 ? 0.044 : wid * 0.86,
      r: 0.74,
      g: 0.74,
      b: 0.75,
      cullFaces: FACE_TOP,
    })
  }

  // Twin parallel fluorescent diffuser tubes inside hood
  const tubeOffset = 0.055
  const tubeLen = len - 0.1
  for (const ts of [-1, 1]) {
    diffuserEntries.push({
      fixtureIndex: fixture.index,
      cx: x + (yaw90 ? ts * tubeOffset : 0),
      cy: hoodCy - 0.026,
      cz: z + (yaw90 ? 0 : ts * tubeOffset),
      sx: yaw90 ? 0.04 : tubeLen,
      sy: 0.034,
      sz: yaw90 ? tubeLen : 0.04,
      ry: 0,
    })
  }

  return {
    minY: hoodCy - 0.055,
    lightY: hoodCy - 0.115, // Strictly below reflector wings & tombstone caps
    sx: sx + 0.06,
    sz: sz + 0.06,
    haloW: sx * 1.28,
    haloD: sz * 1.45,
  }
}

/**
 * Resolves graphics preset PointLight bounce-fill pool budget.
 */
export function resolveOverheadPointLightBudget({
  qualityPreset = 'high',
  dynamicLights = true,
  isSoftwareGl = false,
} = {}) {
  if (!dynamicLights || isSoftwareGl || qualityPreset === 'performance') {
    return 0
  }
  if (qualityPreset === 'balanced') {
    return 2
  }
  return 4
}

export const OVERHEAD_SPOT_DISTANCE = 7.4
export const OVERHEAD_SPOT_SHADOW_FOCUS = 0.56
export const OVERHEAD_SPOT_LOCK_HOLD_RADIUS = 4.2
export const OVERHEAD_SPOT_ACQUIRE_RADIUS = 7.2
export const OVERHEAD_SPOT_KEEP_RADIUS = 11.5
export const OVERHEAD_SPOT_HYSTERESIS_RATIO = 0.58
export const OVERHEAD_SPOT_SHADOW_CASTER_RADIUS = 5.4

/**
 * Resolves graphics preset budgeted shadow-casting overhead SpotLight count (0..1).
 * Balanced disables expensive overhead shadow passes (relying on pooled overhead
 * PointLights + flashlight shadow pass), while High keeps 1 nearby overhead SpotLight.
 */
export function resolveOverheadShadowLightBudget({
  qualityPreset = 'high',
  dynamicLights = true,
  isSoftwareGl = false,
} = {}) {
  if (
    !dynamicLights ||
    isSoftwareGl ||
    qualityPreset === 'performance' ||
    qualityPreset === 'balanced'
  ) {
    return 0
  }
  return 1
}

/**
 * Builds overhead industrial lighting fixtures (recessed panels, protective wire-cage
 * bulkheads, and twin-tube fluorescent battens) with deterministic lighting conditions
 * (`working`, `flickering`, `burned_out`), pooled instanced diffusers, soft diffuser
 * halos, a preset-scaled pool of non-shadow PointLights, and a capped pool of
 * shadow-casting downward SpotLights (`shadowSpotPool`).
 */
export function buildCeilingLights(
  maze,
  {
    soffitY = 3.6,
    beamBottomY = 3.04,
    beamWidth = 0.78,
    ribWidth = 0.42,
    worldSeed = 0,
    ventMetadata = null,
    ductTrunks = null,
    qualityPreset = 'high',
    dynamicLights = true,
    isSoftwareGl = false,
  } = {}
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return null
  }
  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) {
    return null
  }

  const seed =
    ((Number(worldSeed) || 0) * 1664525 + rows * 101 + cols * 239 + 5519) >>> 0
  const rng = createRng(seed)

  const beamHalf = beamWidth * 0.5 // 0.39m
  const ribHalf = ribWidth * 0.5 // 0.21m

  const evenRowZs = []
  for (let r = 2; r <= rows - 3; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (wp) evenRowZs.push(wp.z)
  }
  const evenColXs = []
  for (let c = 2; c <= cols - 3; c += 2) {
    const wp = gridToWorld(0, c, maze)
    if (wp) evenColXs.push(wp.x)
  }
  const oddRowZs = []
  for (let r = 1; r <= rows - 2; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (wp) oddRowZs.push(wp.z)
  }

  const vents = Array.isArray(ventMetadata) ? ventMetadata : []
  const trunks = Array.isArray(ductTrunks) ? ductTrunks : []

  // Clearance helper ensuring fixture bounding box stays away from concrete beams, ribs, vents, and trunks
  const isPositionClear = (fx, fz, halfW, halfD, yMin = 3.35) => {
    for (let i = 0; i < evenRowZs.length; i += 1) {
      if (Math.abs(fz - evenRowZs[i]) < beamHalf + halfD + 0.08) return false
    }
    for (let i = 0; i < evenColXs.length; i += 1) {
      if (Math.abs(fx - evenColXs[i]) < beamHalf + halfW + 0.08) return false
    }
    for (let i = 0; i < oddRowZs.length; i += 1) {
      if (Math.abs(fz - oddRowZs[i]) < ribHalf + halfD + 0.08) return false
    }
    for (let i = 0; i < trunks.length; i += 1) {
      const tr = trunks[i]
      if (typeof tr.z === 'number' && Math.abs(fz - tr.z) < tr.width * 0.5 + halfD + 0.16) {
        return false
      }
      if (typeof tr.x === 'number' && Math.abs(fx - tr.x) < tr.width * 0.5 + halfW + 0.16) {
        return false
      }
    }
    for (let i = 0; i < vents.length; i += 1) {
      const vm = vents[i]
      const overlapX = Math.abs(fx - vm.cx) < vm.sx * 0.5 + halfW + 0.22
      const overlapZ = Math.abs(fz - vm.cz) < vm.sz * 0.5 + halfD + 0.22
      if (overlapX && overlapZ) return false
      // Also avoid blocking branch takeoff runs in the same cell
      if (vm.cellRow !== undefined && vm.cellCol !== undefined) {
        const vmCellWorld = gridToWorld(vm.cellRow, vm.cellCol, maze)
        if (
          vmCellWorld &&
          Math.abs(fx - vmCellWorld.x) < 0.42 + halfW &&
          Math.sign(fz - vmCellWorld.z) === Math.sign(vm.cz - vmCellWorld.z)
        ) {
          return false
        }
      }
    }
    return yMin >= CEILING_LIGHT_CLEARANCE_MIN_Y && yMin > beamBottomY
  }

  // Collect walkable odd-grid corridor cells for well-paced industrial overhead illumination
  const corridorCells = []
  for (let r = 1; r <= rows - 2; r += 2) {
    for (let c = 1; c <= cols - 2; c += 2) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      const wp = gridToWorld(r, c, maze)
      if (!wp) continue
      const northOpen = grid[r - 1]?.[c] === CELL_TYPES.PATH
      const southOpen = grid[r + 1]?.[c] === CELL_TYPES.PATH
      const eastOpen = grid[r]?.[c + 1] === CELL_TYPES.PATH
      const westOpen = grid[r]?.[c - 1] === CELL_TYPES.PATH
      corridorCells.push({
        r,
        c,
        x: wp.x,
        z: wp.z,
        nsAxis: (northOpen || southOpen) && !(eastOpen || westOpen),
        isIntersection:
          (northOpen || southOpen) && (eastOpen || westOpen),
      })
    }
  }

  // Target restrained fixture density (~26-34% of odd corridor bays so light feels moody & realistic)
  const targetFixtures = Math.max(
    4,
    Math.min(34, Math.round(corridorCells.length * 0.34))
  )

  const fixtures = []
  const usedCellKeys = new Set()

  // Prioritize placing a fixture near maze.start (always working) and evenly staggered bays
  const startCell = maze.start
  const tryPlaceAtCell = (cell, forceWorking = false) => {
    const key = `${cell.r},${cell.c}`
    if (usedCellKeys.has(key)) return false

    const designIdx = (cell.r * 3 + cell.c * 5 + fixtures.length) % CEILING_LIGHT_TYPES.length
    const designType = CEILING_LIGHT_TYPES[designIdx]
    const yaw90 = cell.nsAxis && designType === 'fluorescent_batten'

    let halfW
    let halfD
    if (designType === 'cage_bulkhead') {
      halfW = yaw90 ? 0.17 : 0.22
      halfD = yaw90 ? 0.22 : 0.17
    } else if (designType === 'fluorescent_batten') {
      halfW = yaw90 ? 0.15 : 0.61
      halfD = yaw90 ? 0.61 : 0.15
    } else {
      halfW = yaw90 ? 0.25 : 0.43
      halfD = yaw90 ? 0.43 : 0.25
    }

    // Try both North (-1.04m) and South (+1.04m) open concrete sub-coffers inside this cell
    const subOrder = (cell.r + cell.c) % 2 === 0 ? [-1, 1] : [1, -1]
    for (const subSign of subOrder) {
      const candZ = cell.z + subSign * 1.04
      const candX = cell.x + (rng() - 0.5) * 0.24
      if (!isPositionClear(candX, candZ, halfW, halfD)) {
        continue
      }

      usedCellKeys.add(key)
      const emissiveHex =
        designType === 'fluorescent_batten'
          ? CEILING_LIGHT_PALETTE.battenEmissive
          : designType === 'recessed_panel'
            ? CEILING_LIGHT_PALETTE.panelEmissive
            : CEILING_LIGHT_PALETTE.bulkheadEmissive

      fixtures.push({
        index: fixtures.length,
        cellRow: cell.r,
        cellCol: cell.c,
        x: candX,
        z: candZ,
        designType,
        condition: forceWorking ? CEILING_LIGHT_STATES.WORKING : null,
        forceWorking,
        yaw90,
        phase: rng() * Math.PI * 2,
        flickerRateA: 3.1 + rng() * 2.4,
        flickerRateB: 7.4 + rng() * 3.8,
        flickerRateC: 13.5 + rng() * 4.2,
        emissiveHex,
        baseIntensity:
          designType === 'fluorescent_batten'
            ? 1.04
            : designType === 'recessed_panel'
              ? 0.94
              : 0.88,
        _liveIntensity: 0,
        _warmShift: 0,
        minY: soffitY,
        lightY: soffitY - 0.15,
        haloW: 1.0,
        haloD: 1.0,
      })
      return true
    }
    return false
  }

  // First ensure player spawn corridor area receives a working fixture if nearby
  if (startCell) {
    let bestStart = null
    let bestDist = Infinity
    for (const cell of corridorCells) {
      const d = Math.hypot(cell.r - startCell.row, cell.c - startCell.col)
      if (d < bestDist) {
        bestDist = d
        bestStart = cell
      }
    }
    if (bestStart) {
      tryPlaceAtCell(bestStart, true)
    }
  }

  // Evenly stride through remaining corridor cells with neighbor spacing to prevent clustering
  const stride = Math.max(1, Math.floor(corridorCells.length / targetFixtures))
  for (let pass = 0; pass < 2 && fixtures.length < targetFixtures; pass += 1) {
    for (let i = pass; i < corridorCells.length && fixtures.length < targetFixtures; i += pass === 0 ? stride : 1) {
      const cell = corridorCells[i]
      // Avoid putting lights in immediately orthogonal adjacent cells when pass 0
      if (
        pass === 0 &&
        (usedCellKeys.has(`${cell.r - 2},${cell.c}`) ||
          usedCellKeys.has(`${cell.r + 2},${cell.c}`) ||
          usedCellKeys.has(`${cell.r},${cell.c - 2}`) ||
          usedCellKeys.has(`${cell.r},${cell.c + 2}`))
      ) {
        continue
      }
      tryPlaceAtCell(cell, false)
    }
  }

  // Assign deterministic stratified states across non-spawn fixtures:
  // ~58% working, ~24% flickering, ~18% burned_out (majority always stays working)
  const assignable = []
  for (let i = 0; i < fixtures.length; i += 1) {
    if (!fixtures[i].forceWorking) assignable.push(fixtures[i])
  }
  const totalCount = fixtures.length
  const maxBurnedAllowed = Math.max(0, Math.floor(totalCount * 0.25))
  const burnedTarget =
    assignable.length >= 4
      ? Math.min(maxBurnedAllowed, Math.max(1, Math.round(totalCount * 0.17)))
      : 0
  const flickerTarget =
    assignable.length >= 2
      ? Math.min(
          Math.max(1, Math.floor(totalCount * 0.28)),
          Math.max(1, Math.round(totalCount * 0.24))
        )
      : 0

  const stateSlots = []
  for (let i = 0; i < burnedTarget; i += 1) {
    stateSlots.push(CEILING_LIGHT_STATES.BURNED_OUT)
  }
  for (let i = 0; i < flickerTarget; i += 1) {
    stateSlots.push(CEILING_LIGHT_STATES.FLICKERING)
  }
  while (stateSlots.length < assignable.length) {
    stateSlots.push(CEILING_LIGHT_STATES.WORKING)
  }
  // Fisher-Yates deterministic shuffle across assignable fixtures
  for (let i = stateSlots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = stateSlots[i]
    stateSlots[i] = stateSlots[j]
    stateSlots[j] = tmp
  }
  for (let i = 0; i < assignable.length; i += 1) {
    assignable[i].condition = stateSlots[i]
  }

  const workingCount = fixtures.filter((f) => f.condition === CEILING_LIGHT_STATES.WORKING).length
  const burnedCount = fixtures.filter((f) => f.condition === CEILING_LIGHT_STATES.BURNED_OUT).length

  if (fixtures.length === 0) {
    return null
  }

  // Build composite housing/bracket/cage geometry + instanced diffusers + instanced soft halos
  const housingBoxes = []
  const diffuserEntries = []

  for (let i = 0; i < fixtures.length; i += 1) {
    const f = fixtures[i]
    const bounds = appendFixtureGeometry({
      fixture: f,
      soffitY,
      housingBoxes,
      diffuserEntries,
      rng,
    })
    f.minY = bounds.minY
    f.lightY = bounds.lightY
    f.haloW = bounds.haloW
    f.haloD = bounds.haloD
  }

  const metalTex = getGalvanizedMetalTextureSet({ qualityPreset })
  const housingMat = new THREE.MeshStandardMaterial({
    color: CEILING_LIGHT_PALETTE.housingMetal,
    map: metalTex.map,
    roughnessMap: metalTex.roughnessMap,
    bumpMap: metalTex.bumpMap,
    bumpScale: 0.02,
    roughness: 0.86,
    metalness: 0.52,
    envMapIntensity: 0.45,
    vertexColors: true,
  })

  const chunkLayout = createMazeChunkLayout(maze)
  const housingBuckets = chunkLayout.isChunked
    ? bucketItemsByChunk(housingBoxes, (b) => [b.cx, b.cz], chunkLayout)
    : null
  const housingOccupiedChunks = housingBuckets
    ? housingBuckets.reduce((acc, b) => acc + (b.length > 0 ? 1 : 0), 0)
    : 0
  const shouldChunkHousings = shouldChunkLayer({
    layout: chunkLayout,
    triangleCount: countKeptBoxTriangles(housingBoxes),
    occupiedChunks: housingOccupiedChunks,
  })
  const housingChunkEntries = []
  if (shouldChunkHousings) {
    for (let cIdx = 0; cIdx < housingBuckets.length; cIdx += 1) {
      if (housingBuckets[cIdx].length === 0) continue
      const geo = buildMergedFixtureHousingsGeometry(housingBuckets[cIdx], 1.6)
      if (geo) {
        housingChunkEntries.push({ chunkIndex: cIdx, geometry: geo })
      }
    }
  } else {
    const housingGeo = buildMergedFixtureHousingsGeometry(housingBoxes, 1.6)
    if (housingGeo) {
      housingChunkEntries.push({ chunkIndex: 0, geometry: housingGeo })
    }
  }

  // Flush soffit pans, thin trims & cage bars sit above/around lightY and add negligible shadow detail
  const housingMesh = buildChunkedLayerNode({
    layerName: 'maze-ceiling-light-housings',
    chunkEntries: housingChunkEntries,
    material: housingMat,
    castShadow: false,
    receiveShadow: true,
    layout: shouldChunkHousings ? chunkLayout : { ...chunkLayout, isChunked: false },
  })

  // Shared unit box for all diffusers (scaled per instance to panel/bulkhead/twin tubes)
  const unitDiffuserGeo = getPooledLightTexture(
    'unit:diffuser:box',
    () => new THREE.BoxGeometry(1, 1, 1)
  )
  const diffuserMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: true,
    toneMapped: true,
  })
  const dummy = new THREE.Object3D()
  const diffuserBuckets = Array.from({ length: chunkLayout.totalChunks }, (_, chunkIndex) => ({
    chunkIndex,
    items: [],
  }))
  for (let i = 0; i < diffuserEntries.length; i += 1) {
    const d = diffuserEntries[i]
    dummy.position.set(d.cx, d.cy, d.cz)
    dummy.rotation.set(0, d.ry || 0, 0)
    dummy.scale.set(d.sx, d.sy, d.sz)
    dummy.updateMatrix()
    const chunkIdx = chunkLayout.getChunkIndex(d.cx, d.cz)
    diffuserBuckets[chunkIdx].items.push({
      sourceIndex: i,
      matrix: dummy.matrix.clone(),
    })
  }
  const diffuserMesh = buildChunkedInstancedLayerNode({
    layerName: 'maze-ceiling-light-diffusers',
    chunkBuckets: diffuserBuckets,
    geometry: unitDiffuserGeo,
    material: diffuserMat,
    castShadow: false,
    receiveShadow: false,
    layout: chunkLayout,
    trackColors: true,
  })
  const diffuserMeshes = getLayerMeshes(diffuserMesh)
  const diffuserTargets = diffuserMesh?.userData?.instanceTargets || []

  // Optional soft overhead diffuser glow halo planes facing downward (-Y -> normal down)
  const haloTex = getPooledLightTexture('light:halo:tex', createDiffuserHaloTexture)
  const unitHaloGeo = getPooledLightTexture('unit:halo:plane', () => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(Math.PI * 0.5) // Face strictly downward -Y
    return g
  })
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: haloTex,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  })
  const haloBuckets = Array.from({ length: chunkLayout.totalChunks }, (_, chunkIndex) => ({
    chunkIndex,
    items: [],
  }))
  for (let i = 0; i < fixtures.length; i += 1) {
    const f = fixtures[i]
    dummy.position.set(f.x, f.minY - 0.012, f.z)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(f.haloW, 1, f.haloD)
    dummy.updateMatrix()
    const chunkIdx = chunkLayout.getChunkIndex(f.x, f.z)
    haloBuckets[chunkIdx].items.push({
      sourceIndex: i,
      matrix: dummy.matrix.clone(),
    })
  }
  const haloMesh = buildChunkedInstancedLayerNode({
    layerName: 'maze-ceiling-light-halos',
    chunkBuckets: haloBuckets,
    geometry: unitHaloGeo,
    material: haloMat,
    castShadow: false,
    receiveShadow: false,
    layout: chunkLayout,
    trackColors: true,
  })
  const haloMeshes = getLayerMeshes(haloMesh)
  const haloTargets = haloMesh?.userData?.instanceTargets || []

  const lightsGroup = new THREE.Group()
  lightsGroup.name = 'maze-ceiling-lights-group'
  if (housingMesh) lightsGroup.add(housingMesh)
  if (diffuserMesh) lightsGroup.add(diffuserMesh)
  if (haloMesh) lightsGroup.add(haloMesh)

  // Pre-allocate max pool of 4 non-shadow bounce PointLights (soffit & wall bounce with tight corridor decay)
  const pointLightPool = []
  for (let i = 0; i < 4; i += 1) {
    const pt = new THREE.PointLight(
      CEILING_LIGHT_PALETTE.pointLightColor,
      0,
      9.2,
      1.95
    )
    pt.name = `maze-ceiling-overhead-point-${i}`
    pt.castShadow = false
    pt.visible = false
    lightsGroup.add(pt)
    pointLightPool.push(pt)
  }

  // Pre-allocate strictly budgeted pool of shadow-casting downward SpotLights for real fixture shadows
  // Tighter distance & shadow.focus prevent Three.js SpotLightShadow.updateMatrices from expanding the
  // shadow frustum beyond local corridor bays, and shadow.autoUpdate=false caches static corridor depth maps.
  const shadowSpotPool = []
  for (let i = 0; i < 2; i += 1) {
    const spot = new THREE.SpotLight(
      CEILING_LIGHT_PALETTE.spotLightColor,
      0,
      OVERHEAD_SPOT_DISTANCE,
      Math.PI * 0.44,
      0.74,
      1.65
    )
    spot.name = `maze-ceiling-overhead-spot-${i}`
    spot.castShadow = true
    if (spot.shadow) {
      spot.shadow.autoUpdate = false
      spot.shadow.needsUpdate = true
      spot.shadow.focus = OVERHEAD_SPOT_SHADOW_FOCUS
      spot.shadow.mapSize?.set?.(512, 512)
      spot.shadow.bias = -0.0007
      spot.shadow.normalBias = 0.026
      spot.shadow.radius = 1.7
      if (spot.shadow.camera) {
        spot.shadow.camera.near = 0.22
        spot.shadow.camera.far = OVERHEAD_SPOT_DISTANCE
        spot.shadow.camera.fov = Math.round((180 / Math.PI) * 2 * (Math.PI * 0.44) * OVERHEAD_SPOT_SHADOW_FOCUS)
        spot.shadow.camera.updateProjectionMatrix?.()
      }
    }
    spot._lastShadowFixtureIdx = -1
    spot._lastShadowCacheVersion = -1
    spot._lastCasterCount = -1
    spot._lastCasterHash = 0
    const target = new THREE.Object3D()
    target.name = `maze-ceiling-overhead-spot-target-${i}`
    spot.target = target
    spot.visible = false
    lightsGroup.add(spot)
    lightsGroup.add(target)
    shadowSpotPool.push(spot)
  }

  const flickeringCount = fixtures.filter(
    (f) => f.condition === CEILING_LIGHT_STATES.FLICKERING
  ).length

  // Lightweight read-only grid geometry table for zero-allocation wall-occlusion checks
  const cellSize = 4
  const mazeGridInfo = {
    grid,
    rows,
    cols,
    cellSize,
    originX: -(cols * cellSize) * 0.5,
    originZ: -(rows * cellSize) * 0.5,
  }

  lightsGroup.userData = {
    isMazeCeilingLights: true,
    housingMesh,
    housingMat,
    diffuserMesh,
    diffuserMeshes,
    diffuserTargets,
    diffuserMat,
    haloMesh,
    haloMeshes,
    haloTargets,
    haloMat,
    pointLightPool,
    shadowSpotPool,
    fixtures,
    diffuserEntries,
    mazeGridInfo,
    fixtureCount: fixtures.length,
    workingCount,
    flickeringCount,
    burnedOutCount: burnedCount,
    currentLightScale: 1,
    qualityPreset,
    dynamicLights,
    isSoftwareGl,
    highContrast: false,
    reducedMotion: false,
    _nearestIndices: [-1, -1, -1, -1],
    _nearestScores: [Infinity, Infinity, Infinity, Infinity],
    _nearestAtten: [0, 0, 0, 0],
    _nearestDists: [Infinity, Infinity, Infinity, Infinity],
    _nearestWallHits: [0, 0, 0, 0],
    _lockedSpotIndices: [-1, -1],
    _chosenSpotIndices: [-1, -1],
    _chosenSpotAtten: [0, 0],
    _shadowCacheVersion: 1,
    _diffuserColorCache: new Float32Array(diffuserEntries.length * 3).fill(-1),
    _haloColorCache: new Float32Array(fixtures.length * 3).fill(-1),
    _diffuserDirtyChunks: new Uint8Array(diffuserMeshes.length),
    _haloDirtyChunks: new Uint8Array(haloMeshes.length),
    _diffuserColorsInitialized: false,
    _haloColorsInitialized: false,
    _lastColorElapsedSec: null,
    _lastColorLightScale: null,
    _lastColorHcActive: null,
    _lastColorRmActive: null,
    _lastHaloVisible: null,
  }

  // Initialize deterministic starting diffuser & light colors immediately
  stepCeilingLights(lightsGroup, 0, {
    lightScale: 1,
    reducedMotion: false,
    highContrast: false,
    qualityPreset,
    dynamicLights,
    isSoftwareGl,
  })

  return lightsGroup
}

function findCeilingLightsGroup(target) {
  if (!target) return null
  if (target.userData?.isMazeCeilingLights) return target
  if (target.userData?.ceilingLightsGroup) return target.userData.ceilingLightsGroup
  if (target.userData?.ceilingGroup?.userData?.ceilingLightsGroup) {
    return target.userData.ceilingGroup.userData.ceilingLightsGroup
  }
  return target.getObjectByName?.('maze-ceiling-lights-group') || null
}

/**
 * Zero-allocation 2D grid DDA traversal counting concrete wall cells between
 * player (px, pz) and overhead fixture (fx, fz).
 */
function countWallOcclusionsBetween(gridInfo, px, pz, fx, fz) {
  if (!gridInfo || !gridInfo.grid) return 0
  const { grid, rows, cols, cellSize, originX, originZ } = gridInfo
  const gx0 = (px - originX) / cellSize
  const gz0 = (pz - originZ) / cellSize
  const gx1 = (fx - originX) / cellSize
  const gz1 = (fz - originZ) / cellSize

  let c = Math.floor(gx0)
  let r = Math.floor(gz0)
  const endC = Math.floor(gx1)
  const endR = Math.floor(gz1)

  if (c === endC && r === endR) return 0

  const dx = gx1 - gx0
  const dz = gz1 - gz0
  const stepC = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepR = dz > 0 ? 1 : dz < 0 ? -1 : 0

  const tDeltaC = stepC !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaR = stepR !== 0 ? Math.abs(1 / dz) : Infinity

  let tMaxC =
    stepC > 0
      ? (c + 1 - gx0) * tDeltaC
      : stepC < 0
        ? (gx0 - c) * tDeltaC
        : Infinity
  let tMaxR =
    stepR > 0
      ? (r + 1 - gz0) * tDeltaR
      : stepR < 0
        ? (gz0 - r) * tDeltaR
        : Infinity

  let wallHits = 0
  for (let iter = 0; iter < 14; iter += 1) {
    if (c === endC && r === endR) break
    if (tMaxC < tMaxR) {
      tMaxC += tDeltaC
      c += stepC
    } else {
      tMaxR += tDeltaR
      r += stepR
    }
    if (r < 0 || r >= rows || c < 0 || c >= cols) break
    if (c === endC && r === endR) break
    if (grid[r][c] === CELL_TYPES.WALL) {
      wallHits += 1
      if (wallHits >= 2) break
    }
  }
  return wallHits
}

/**
 * Marks cached static overhead SpotLight shadow maps dirty so Three.js refreshes
 * them on the next rendered frame (e.g. maze reload, preset change, door/gate toggle).
 */
export function invalidateOverheadShadowCache(rootOrLightsGroup) {
  const lightsGroup = findCeilingLightsGroup(rootOrLightsGroup)
  const ud = lightsGroup?.userData
  if (!ud || !ud.isMazeCeilingLights) return false
  ud._shadowCacheVersion = (ud._shadowCacheVersion || 0) + 1
  const pool = ud.shadowSpotPool || []
  for (let i = 0; i < pool.length; i += 1) {
    if (pool[i].shadow) {
      pool[i].shadow.needsUpdate = true
    }
  }
  return true
}

/**
 * Updates overhead fixture flicker modulation, HorrorDirector blackout scaling,
 * Reduced Motion stability, High Contrast restraint, corridor-aware pooled
 * PointLights, and hysteresis-stabilized cached shadow SpotLights with zero allocations.
 */
export function stepCeilingLights(
  rootOrLightsGroup,
  elapsedSec = 0,
  {
    playerWorldPos = null,
    lightScale = 1,
    reducedMotion = false,
    highContrast = false,
    qualityPreset = null,
    dynamicLights = null,
    isSoftwareGl = null,
    dynamicShadowCasters = null,
  } = {}
) {
  const lightsGroup = findCeilingLightsGroup(rootOrLightsGroup)
  const ud = lightsGroup?.userData
  if (!ud || !ud.isMazeCeilingLights) return false

  const {
    fixtures,
    diffuserEntries,
    diffuserMesh,
    diffuserMeshes = diffuserMesh ? [diffuserMesh] : [],
    diffuserTargets = null,
    haloMesh,
    haloMeshes = haloMesh ? [haloMesh] : [],
    haloTargets = null,
    pointLightPool,
    shadowSpotPool = [],
    mazeGridInfo = null,
  } = ud

  const resolvedQuality = qualityPreset ?? ud.qualityPreset ?? 'high'
  const resolvedDynamic =
    typeof dynamicLights === 'boolean' ? dynamicLights : ud.dynamicLights !== false
  const resolvedSoftwareGl =
    typeof isSoftwareGl === 'boolean' ? isSoftwareGl : Boolean(ud.isSoftwareGl)
  const hcActive = Boolean(highContrast)
  const rmActive = Boolean(reducedMotion)

  ud.qualityPreset = resolvedQuality
  ud.dynamicLights = resolvedDynamic
  ud.isSoftwareGl = resolvedSoftwareGl
  ud.highContrast = hcActive
  ud.reducedMotion = rmActive

  const scaleFactor = Math.max(0.03, Math.min(1.25, Number(lightScale) || 1))
  ud.currentLightScale = scaleFactor
  const t = Number.isFinite(elapsedSec) ? elapsedSec : 0
  const contrastMult = hcActive ? 0.72 : 1.0

  // 1. Compute each fixture's live intensity & color shift once per frame without allocation
  for (let i = 0; i < fixtures.length; i += 1) {
    const f = fixtures[i]
    let level = 0
    let warmShift = 0
    if (f.condition === CEILING_LIGHT_STATES.WORKING) {
      level = f.baseIntensity
    } else if (f.condition === CEILING_LIGHT_STATES.FLICKERING) {
      if (rmActive) {
        // Reduced motion: calm steady dimmed ballast level without oscillation
        level = f.baseIntensity * 0.68
        warmShift = 0.22
      } else {
        // Multi-harmonic irregular ballast dip (comfortable [0.40..1.0], no aggressive strobe)
        const wA = Math.sin(t * f.flickerRateA + f.phase)
        const wB = Math.sin(t * f.flickerRateB + f.phase * 1.7)
        const wC = Math.sin(t * (f.flickerRateC || 14.1) + f.phase * 2.3)
        const composite = wA * 0.55 + wB * 0.3 + wC * 0.15
        const dipAmount = smoothstep(0.26, 0.78, composite)
        const subtleHum = 0.91 + 0.09 * Math.cos(t * 2.1 + f.phase)
        level = f.baseIntensity * (1 - dipAmount * 0.52) * subtleHum
        warmShift = dipAmount * 0.85
      }
    }

    f._liveIntensity = level * scaleFactor * contrastMult
    f._warmShift = warmShift
  }

  // 2. Update instanced diffusers & additive halos only when colors actually change
  const diffCache = ud._diffuserColorCache
  let allDiffusersHaveAttr = diffuserMeshes.length > 0
  for (let m = 0; m < diffuserMeshes.length; m += 1) {
    if (!diffuserMeshes[m].instanceColor) {
      allDiffusersHaveAttr = false
      break
    }
  }
  const needsFullDiffuserSync =
    !ud._diffuserColorsInitialized ||
    !allDiffusersHaveAttr ||
    !diffCache ||
    diffCache.length !== diffuserEntries.length * 3
  const globalStyleChanged =
    scaleFactor !== ud._lastColorLightScale ||
    hcActive !== ud._lastColorHcActive
  const flickerTimeChanged =
    !rmActive && ud.flickeringCount > 0 && t !== ud._lastColorElapsedSec
  const rmModeChanged = rmActive !== ud._lastColorRmActive

  if (
    diffuserMeshes.length > 0 &&
    (needsFullDiffuserSync || globalStyleChanged || flickerTimeChanged || rmModeChanged)
  ) {
    const dirtyDiffChunks = ud._diffuserDirtyChunks
    if (dirtyDiffChunks) dirtyDiffChunks.fill(0)
    const onlyFlickeringMayChange = !needsFullDiffuserSync && !globalStyleChanged

    for (let i = 0; i < diffuserEntries.length; i += 1) {
      const d = diffuserEntries[i]
      const f = fixtures[d.fixtureIndex]
      if (onlyFlickeringMayChange && f.condition !== CEILING_LIGHT_STATES.FLICKERING) {
        continue
      }
      if (f.condition === CEILING_LIGHT_STATES.BURNED_OUT) {
        _tmpColor
          .setHex(CEILING_LIGHT_PALETTE.burnedOutGlass)
          .multiplyScalar(Math.max(0.25, scaleFactor))
      } else {
        _tmpColor.setHex(f.emissiveHex || CEILING_LIGHT_PALETTE.workingEmissive)
        if (f._warmShift > 0.01) {
          _tmpColor.lerp(_tmpColorFlicker, f._warmShift * 0.75)
        }
        _tmpColor.multiplyScalar(Math.max(0.05, f._liveIntensity))
      }

      const target = diffuserTargets ? diffuserTargets[i] : null
      const targetMesh = target ? target.mesh : diffuserMesh
      const targetIndex = target ? target.localIndex : i
      const targetMeshIndex = target ? target.meshIndex : 0
      const hasAttr = Boolean(targetMesh?.instanceColor)
      const off = i * 3

      if (
        needsFullDiffuserSync ||
        !hasAttr ||
        Math.abs(_tmpColor.r - diffCache[off]) > INSTANCE_COLOR_EPSILON ||
        Math.abs(_tmpColor.g - diffCache[off + 1]) > INSTANCE_COLOR_EPSILON ||
        Math.abs(_tmpColor.b - diffCache[off + 2]) > INSTANCE_COLOR_EPSILON
      ) {
        targetMesh.setColorAt(targetIndex, _tmpColor)
        if (diffCache && off + 2 < diffCache.length) {
          diffCache[off] = _tmpColor.r
          diffCache[off + 1] = _tmpColor.g
          diffCache[off + 2] = _tmpColor.b
        }
        if (dirtyDiffChunks && targetMeshIndex < dirtyDiffChunks.length) {
          dirtyDiffChunks[targetMeshIndex] = 1
        }
      }
    }
    for (let m = 0; m < diffuserMeshes.length; m += 1) {
      if ((!dirtyDiffChunks || dirtyDiffChunks[m]) && diffuserMeshes[m].instanceColor) {
        diffuserMeshes[m].instanceColor.needsUpdate = true
      }
    }
    ud._diffuserColorsInitialized = true
  }

  if (haloMesh) {
    const haloVisible = resolvedQuality !== 'performance' && !hcActive
    if (haloMesh.visible !== haloVisible) {
      haloMesh.visible = haloVisible
    }
    for (let m = 0; m < haloMeshes.length; m += 1) {
      if (haloMeshes[m].visible !== haloVisible) {
        haloMeshes[m].visible = haloVisible
      }
    }
    if (haloVisible) {
      const haloCache = ud._haloColorCache
      let allHalosHaveAttr = haloMeshes.length > 0
      for (let m = 0; m < haloMeshes.length; m += 1) {
        if (!haloMeshes[m].instanceColor) {
          allHalosHaveAttr = false
          break
        }
      }
      const needsFullHaloSync =
        !ud._haloColorsInitialized ||
        !allHalosHaveAttr ||
        !haloCache ||
        haloCache.length !== fixtures.length * 3
      const haloVisibilityRestored = ud._lastHaloVisible === false

      if (
        haloMeshes.length > 0 &&
        (needsFullHaloSync ||
          haloVisibilityRestored ||
          globalStyleChanged ||
          flickerTimeChanged ||
          rmModeChanged)
      ) {
        const dirtyHaloChunks = ud._haloDirtyChunks
        if (dirtyHaloChunks) dirtyHaloChunks.fill(0)
        const onlyFlickeringHaloMayChange =
          !needsFullHaloSync && !haloVisibilityRestored && !globalStyleChanged

        for (let i = 0; i < fixtures.length; i += 1) {
          const f = fixtures[i]
          if (onlyFlickeringHaloMayChange && f.condition !== CEILING_LIGHT_STATES.FLICKERING) {
            continue
          }
          if (f.condition === CEILING_LIGHT_STATES.BURNED_OUT) {
            _tmpColorDim.setRGB(0, 0, 0)
          } else {
            _tmpColorDim.setHex(f.emissiveHex || CEILING_LIGHT_PALETTE.workingEmissive)
            if (f._warmShift > 0.01) {
              _tmpColorDim.lerp(_tmpColorFlicker, f._warmShift * 0.75)
            }
            _tmpColorDim.multiplyScalar(f._liveIntensity * 0.38)
          }

          const target = haloTargets ? haloTargets[i] : null
          const targetMesh = target ? target.mesh : haloMesh
          const targetIndex = target ? target.localIndex : i
          const targetMeshIndex = target ? target.meshIndex : 0
          const hasAttr = Boolean(targetMesh?.instanceColor)
          const off = i * 3

          if (
            needsFullHaloSync ||
            !hasAttr ||
            Math.abs(_tmpColorDim.r - haloCache[off]) > INSTANCE_COLOR_EPSILON ||
            Math.abs(_tmpColorDim.g - haloCache[off + 1]) > INSTANCE_COLOR_EPSILON ||
            Math.abs(_tmpColorDim.b - haloCache[off + 2]) > INSTANCE_COLOR_EPSILON
          ) {
            targetMesh.setColorAt(targetIndex, _tmpColorDim)
            if (haloCache && off + 2 < haloCache.length) {
              haloCache[off] = _tmpColorDim.r
              haloCache[off + 1] = _tmpColorDim.g
              haloCache[off + 2] = _tmpColorDim.b
            }
            if (dirtyHaloChunks && targetMeshIndex < dirtyHaloChunks.length) {
              dirtyHaloChunks[targetMeshIndex] = 1
            }
          }
        }
        for (let m = 0; m < haloMeshes.length; m += 1) {
          if ((!dirtyHaloChunks || dirtyHaloChunks[m]) && haloMeshes[m].instanceColor) {
            haloMeshes[m].instanceColor.needsUpdate = true
          }
        }
        ud._haloColorsInitialized = true
      }
    }
    ud._lastHaloVisible = haloVisible
  }

  ud._lastColorElapsedSec = t
  ud._lastColorLightScale = scaleFactor
  ud._lastColorHcActive = hcActive
  ud._lastColorRmActive = rmActive

  // 3. Assign nearest corridor-visible active fixtures to PointLight & shadow SpotLight pools
  const pointBudget = resolveOverheadPointLightBudget({
    qualityPreset: resolvedQuality,
    dynamicLights: resolvedDynamic,
    isSoftwareGl: resolvedSoftwareGl,
  })
  const spotBudget = resolveOverheadShadowLightBudget({
    qualityPreset: resolvedQuality,
    dynamicLights: resolvedDynamic,
    isSoftwareGl: resolvedSoftwareGl,
  })
  const topK = Math.max(pointBudget, spotBudget)

  if (topK === 0 || (pointLightPool.length === 0 && shadowSpotPool.length === 0)) {
    for (let i = 0; i < pointLightPool.length; i += 1) {
      pointLightPool[i].visible = false
      pointLightPool[i].intensity = 0
    }
    for (let i = 0; i < shadowSpotPool.length; i += 1) {
      shadowSpotPool[i].visible = false
      shadowSpotPool[i].intensity = 0
      shadowSpotPool[i]._lastShadowFixtureIdx = -1
    }
    if (ud._lockedSpotIndices) {
      ud._lockedSpotIndices.fill(-1)
    }
    return true
  }

  const px = playerWorldPos?.x ?? 0
  const pz = playerWorldPos?.z ?? 0
  const bestIndices = ud._nearestIndices
  const bestScores = ud._nearestScores
  const bestAtten = ud._nearestAtten
  const bestDists = ud._nearestDists
  const bestWallHits = ud._nearestWallHits

  for (let k = 0; k < topK; k += 1) {
    bestIndices[k] = -1
    bestScores[k] = Infinity
    bestAtten[k] = 0
    bestDists[k] = Infinity
    if (bestWallHits) bestWallHits[k] = 0
  }

  for (let i = 0; i < fixtures.length; i += 1) {
    const f = fixtures[i]
    if (f.condition === CEILING_LIGHT_STATES.BURNED_OUT || f._liveIntensity <= 0) {
      continue
    }
    const dSq = (f.x - px) * (f.x - px) + (f.z - pz) * (f.z - pz)
    const dist = Math.sqrt(dSq)
    // Smooth edge fade beyond 9m so lights entering/leaving pool don't pop
    const distFade = dist <= 9.0 ? 1 : 1 - smoothstep(9.0, 15.0, dist)
    if (distFade <= 0.005) continue

    const wallHits =
      playerWorldPos && mazeGridInfo
        ? countWallOcclusionsBetween(mazeGridInfo, px, pz, f.x, f.z)
        : 0
    const wallAtten = wallHits === 0 ? 1.0 : wallHits === 1 ? 0.28 : 0.0
    if (wallAtten <= 0.005) continue

    const score = dSq + wallHits * 72
    const atten = distFade * wallAtten

    // Insert into top-K active corridor fixtures (K <= 4)
    for (let k = 0; k < topK; k += 1) {
      if (score < bestScores[k]) {
        for (let shift = topK - 1; shift > k; shift -= 1) {
          bestScores[shift] = bestScores[shift - 1]
          bestIndices[shift] = bestIndices[shift - 1]
          bestAtten[shift] = bestAtten[shift - 1]
          bestDists[shift] = bestDists[shift - 1]
          if (bestWallHits) bestWallHits[shift] = bestWallHits[shift - 1]
        }
        bestScores[k] = score
        bestIndices[k] = i
        bestAtten[k] = atten
        bestDists[k] = dist
        if (bestWallHits) bestWallHits[k] = wallHits
        break
      }
    }
  }

  // Update non-shadow corridor bounce PointLights (ambient soffit/wall fill around working fixtures).
  // Balanced omits overhead SpotLight shadow passes, so gently reinforce PointLight fill to preserve corridor brightness.
  const basePointIntensity =
    resolvedQuality === 'high' ? 2.15 : spotBudget === 0 ? 2.05 : 1.78
  for (let k = 0; k < pointLightPool.length; k += 1) {
    const pt = pointLightPool[k]
    const fIdx = k < pointBudget ? bestIndices[k] : -1
    if (fIdx < 0) {
      pt.visible = false
      pt.intensity = 0
      continue
    }
    const f = fixtures[fIdx]
    if (pt.position.x !== f.x || pt.position.y !== f.lightY || pt.position.z !== f.z) {
      pt.position.set(f.x, f.lightY, f.z)
    }
    pt.color.setHex(f.emissiveHex || CEILING_LIGHT_PALETTE.pointLightColor)
    if (f._warmShift > 0.01) {
      pt.color.lerp(_tmpColorFlicker, f._warmShift * 0.75)
    }
    pt.intensity = basePointIntensity * f._liveIntensity * bestAtten[k]
    pt.visible = pt.intensity > 0.01
  }

  // Select overhead shadow-casting SpotLights using proximity thresholds & hysteresis so
  // moving near midpoints or corners doesn't cause rapid fixture swapping or shadow pop.
  const lockedIndices = ud._lockedSpotIndices || [-1, -1]
  const chosenIndices = ud._chosenSpotIndices || [-1, -1]
  const chosenAtten = ud._chosenSpotAtten || [0, 0]
  for (let k = 0; k < shadowSpotPool.length; k += 1) {
    chosenIndices[k] = -1
    chosenAtten[k] = 0
  }

  for (let k = 0; k < spotBudget && k < shadowSpotPool.length; k += 1) {
    const lockedIdx = lockedIndices[k]
    let lockedValid = false
    let lockedScore = Infinity
    let lockedDist = Infinity
    let lockedWallHits = 0
    let lockedAtten = 0

    if (lockedIdx >= 0 && lockedIdx < fixtures.length) {
      let alreadyUsed = false
      for (let prev = 0; prev < k; prev += 1) {
        if (chosenIndices[prev] === lockedIdx) {
          alreadyUsed = true
          break
        }
      }
      const lf = fixtures[lockedIdx]
      if (!alreadyUsed && lf.condition !== CEILING_LIGHT_STATES.BURNED_OUT && lf._liveIntensity > 0) {
        const dSq = (lf.x - px) * (lf.x - px) + (lf.z - pz) * (lf.z - pz)
        lockedDist = Math.sqrt(dSq)
        const distFade = lockedDist <= 9.0 ? 1 : 1 - smoothstep(9.0, 15.0, lockedDist)
        lockedWallHits =
          playerWorldPos && mazeGridInfo
            ? countWallOcclusionsBetween(mazeGridInfo, px, pz, lf.x, lf.z)
            : 0
        const wallAtten = lockedWallHits === 0 ? 1.0 : lockedWallHits === 1 ? 0.28 : 0.0
        lockedAtten = distFade * wallAtten
        lockedScore = dSq + lockedWallHits * 72
        if (
          lockedDist <= OVERHEAD_SPOT_KEEP_RADIUS &&
          distFade > 0.005 &&
          wallAtten > 0.005
        ) {
          lockedValid = true
        }
      }
    }

    let candIdx = -1
    let candScore = Infinity
    let candDist = Infinity
    let candWallHits = 0
    let candAtten = 0
    for (let m = 0; m < topK; m += 1) {
      const idx = bestIndices[m]
      if (idx < 0) continue
      let taken = false
      for (let prev = 0; prev < k; prev += 1) {
        if (chosenIndices[prev] === idx) {
          taken = true
          break
        }
      }
      if (taken) continue
      candIdx = idx
      candScore = bestScores[m]
      candDist = bestDists[m]
      candWallHits = bestWallHits ? bestWallHits[m] : 0
      candAtten = bestAtten[m]
      break
    }

    let nextIdx = lockedIdx
    let nextAtten = lockedAtten
    if (!lockedValid) {
      nextIdx = candIdx
      nextAtten = candAtten
    } else if (candIdx >= 0 && candIdx !== lockedIdx) {
      const inCloseHoldZone =
        lockedDist <= OVERHEAD_SPOT_LOCK_HOLD_RADIUS && lockedWallHits === 0
      if (!inCloseHoldZone) {
        const clearerCorridorTakeover =
          lockedWallHits >= 1 &&
          candWallHits === 0 &&
          candDist <= 8.5 &&
          candDist < lockedDist
        const proximityHysteresisTakeover =
          candDist <= OVERHEAD_SPOT_ACQUIRE_RADIUS &&
          candScore < lockedScore * OVERHEAD_SPOT_HYSTERESIS_RATIO
        if (clearerCorridorTakeover || proximityHysteresisTakeover) {
          nextIdx = candIdx
          nextAtten = candAtten
        }
      }
    }

    lockedIndices[k] = nextIdx
    chosenIndices[k] = nextIdx
    chosenAtten[k] = nextAtten
  }
  for (let k = spotBudget; k < lockedIndices.length; k += 1) {
    lockedIndices[k] = -1
  }

  // Update budgeted downward shadow-casting SpotLights with static shadow map caching
  const baseSpotIntensity = resolvedQuality === 'high' ? 3.45 : 2.85
  const cacheVersion = ud._shadowCacheVersion || 1
  const casterRadiusSq =
    OVERHEAD_SPOT_SHADOW_CASTER_RADIUS * OVERHEAD_SPOT_SHADOW_CASTER_RADIUS
  const hasCastersList = Array.isArray(dynamicShadowCasters)

  for (let k = 0; k < shadowSpotPool.length; k += 1) {
    const spot = shadowSpotPool[k]
    const fIdx = k < spotBudget ? chosenIndices[k] : -1
    if (fIdx < 0) {
      spot.visible = false
      spot.intensity = 0
      spot._lastShadowFixtureIdx = -1
      spot._lastCasterCount = -1
      continue
    }

    const f = fixtures[fIdx]
    const fx = f.x
    const fy = f.lightY
    const fz = f.z
    const wasHidden = !spot.visible
    const fixtureChanged = spot._lastShadowFixtureIdx !== fIdx
    const cacheVersionChanged = spot._lastShadowCacheVersion !== cacheVersion

    if (spot.position.x !== fx || spot.position.y !== fy || spot.position.z !== fz) {
      spot.position.set(fx, fy, fz)
    }
    if (spot.target) {
      const tp = spot.target.position
      if (tp.x !== fx || tp.y !== 0 || tp.z !== fz || spot._lastTargetIdx !== fIdx) {
        tp.set(fx, 0, fz)
        spot.target.updateMatrixWorld?.()
        spot._lastTargetIdx = fIdx
      }
    }

    spot.color.setHex(f.emissiveHex || CEILING_LIGHT_PALETTE.spotLightColor)
    if (f._warmShift > 0.01) {
      spot.color.lerp(_tmpColorFlicker, f._warmShift * 0.75)
    }
    spot.intensity = baseSpotIntensity * f._liveIntensity * chosenAtten[k]
    spot.visible = spot.intensity > 0.01

    if (spot.visible && spot.shadow) {
      let castersDirty = false
      if (hasCastersList) {
        let nearCount = 0
        let sigHash = 0
        for (let ci = 0; ci < dynamicShadowCasters.length; ci += 1) {
          const caster = dynamicShadowCasters[ci]
          if (!caster) continue
          const dx = caster.x - fx
          const dz = caster.z - fz
          if (dx * dx + dz * dz <= casterRadiusSq) {
            nearCount += 1
            const qx = Math.round(caster.x * 32)
            const qy = Math.round((caster.y || 0) * 32)
            const qz = Math.round(caster.z * 32)
            const qr = Math.round((caster.ry || 0) * 16)
            sigHash = (sigHash + ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791) ^ (qr * 49979687))) | 0
          }
        }
        if (
          (nearCount > 0 &&
            (nearCount !== spot._lastCasterCount || sigHash !== spot._lastCasterHash)) ||
          (nearCount === 0 && spot._lastCasterCount > 0)
        ) {
          castersDirty = true
        }
        spot._lastCasterCount = nearCount
        spot._lastCasterHash = sigHash
      }

      if (wasHidden || fixtureChanged || cacheVersionChanged || castersDirty) {
        spot.shadow.needsUpdate = true
      }
      spot._lastShadowFixtureIdx = fIdx
      spot._lastShadowCacheVersion = cacheVersion
    }
  }

  return true
}

export function syncCeilingLightsQuality(lightsGroup, qualityPreset = 'high') {
  if (!lightsGroup) return false
  const metalTex = getGalvanizedMetalTextureSet({ qualityPreset })
  const housingMat = lightsGroup.userData?.housingMat
  if (housingMat) {
    if (
      housingMat.map !== metalTex.map ||
      housingMat.roughnessMap !== metalTex.roughnessMap ||
      housingMat.bumpMap !== metalTex.bumpMap
    ) {
      housingMat.map = metalTex.map
      housingMat.roughnessMap = metalTex.roughnessMap
      housingMat.bumpMap = metalTex.bumpMap
      housingMat.needsUpdate = true
    }
  }
  return true
}
