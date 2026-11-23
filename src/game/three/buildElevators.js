import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import {
  markSharedResource,
  registerSharedPoolClearer,
  registerTextureAnisotropySyncer,
} from './sharedResources.js'
import {
  ELEVATOR_SHAFT_CONFIG,
  applyShaftDepthDarknessShader,
} from './shaftDepthShader.js'

export const ELEVATOR_DECK_TOP_Y = 0.06
export const ELEVATOR_DECK_HALF_SPAN = 1.44
export const ELEVATOR_RAMP_WIDTH = 0.4
export const ELEVATOR_OUTER_BOUND = ELEVATOR_DECK_HALF_SPAN + ELEVATOR_RAMP_WIDTH

export const ELEVATOR_PALETTE = {
  subfloorDark: 0x0c1118,
  steelDark: 0x222b36,
  steelMid: 0x3b4757,
  steelBrushed: 0x526173,
  steelLight: 0x6c7c8f,
  rustDark: 0x452619,
  rustMid: 0x6c3822,
  rustBright: 0x8b4a2b,
  cableSteel: 0x313842,
  copperWire: 0xb86d3b,
  hazardYellow: 0xd99b18,
  hazardFaded: 0x7b5a1c,
  hazardBlack: 0x161a20,
  deadLampGlass: 0x3a2a1c,
  exitUnlockedAccent: 0x10b981,
  exitUnlockedGlow: 0x6ee7b7,
  exitLockedAccent: 0xef4444,
  exitLockedGlow: 0xf97316,
  exitExtractingAccent: 0xf59e0b,
  exitExtractingGlow: 0xfde68a,
  exitConfirmedGlow: 0xa7f3d0,
  glassTint: 0x172533,
}

const elevatorTexturePool = new Map()
const createdElevatorTextures = new Set()

function normalizeQualityPreset(preset) {
  if (preset === 'performance' || preset === 'balanced' || preset === 'high') {
    return preset
  }
  return 'high'
}

function getElevatorTextureSize(qualityPreset) {
  switch (normalizeQualityPreset(qualityPreset)) {
    case 'performance':
      return 64
    case 'balanced':
      return 128
    default:
      return 256
  }
}

function hash2D(x, y, seed = 0) {
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(seed | 0, 1442695041)) |
    0
  n = (n ^ (n >>> 13)) | 0
  n = Math.imul(n, 1274126177) | 0
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function buildPeriodicNoiseGrid(period, seed) {
  const grid = new Float32Array(period * period)
  for (let y = 0; y < period; y += 1) {
    for (let x = 0; x < period; x += 1) {
      grid[y * period + x] = hash2D(x, y, seed)
    }
  }
  return grid
}

function samplePeriodicGrid(grid, period, u, v) {
  const fx = u * period
  const fy = v * period
  const x0 = Math.floor(fx) % period
  const y0 = Math.floor(fy) % period
  const x1 = x0 + 1 >= period ? 0 : x0 + 1
  const y1 = y0 + 1 >= period ? 0 : y0 + 1
  const tx = fx - Math.floor(fx)
  const ty = fy - Math.floor(fy)
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const row0 = y0 * period
  const row1 = y1 * period
  const a = grid[row0 + x0]
  const b = grid[row0 + x1]
  const c = grid[row1 + x0]
  const d = grid[row1 + x1]
  const ab = a + (b - a) * sx
  const cd = c + (d - c) * sx
  return ab + (cd - ab) * sy
}

function buildFbmLut(size, basePeriod, seed) {
  const out = new Float32Array(size * size)
  const g0 = buildPeriodicNoiseGrid(basePeriod, seed)
  const g1 = buildPeriodicNoiseGrid(basePeriod * 2, seed + 79)
  const invSize = 1 / size
  for (let y = 0; y < size; y += 1) {
    const v = y * invSize
    const rowOff = y * size
    for (let x = 0; x < size; x += 1) {
      const u = x * invSize
      out[rowOff + x] =
        (samplePeriodicGrid(g0, basePeriod, u, v) * 0.667 +
          samplePeriodicGrid(g1, basePeriod * 2, u, v) * 0.333)
    }
  }
  return out
}

function clampByte(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : v | 0
}

function configureDataTexture(tex, { isColor = true, repeatX = 1, repeatY = 1 } = {}) {
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeatX, repeatY)
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 4
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.needsUpdate = true
  markSharedResource(tex)
  createdElevatorTextures.add(tex)
  return tex
}

function buildDiamondPlateTextures(size, rusted = false) {
  const colorData = new Uint8Array(size * size * 4)
  const bumpData = new Uint8Array(size * size * 4)
  const roughData = new Uint8Array(size * size * 4)
  const grimeLut = buildFbmLut(size, 8, rusted ? 911 : 403)
  const scratchLut = buildFbmLut(size, 16, 177)
  const cells = 8
  const invSize = 1 / size

  for (let y = 0; y < size; y += 1) {
    const v = y * invSize
    const gy = v * cells
    const cy = Math.floor(gy)
    const ly = gy - cy - 0.5
    const rowOff = y * size

    for (let x = 0; x < size; x += 1) {
      const u = x * invSize
      const pIdx = rowOff + x
      const idx = pIdx * 4

      const gx = u * cells
      const cx = Math.floor(gx)
      const lx = gx - cx - 0.5
      const odd = (cx + cy) & 1
      const rx = odd ? lx * 0.707 - ly * 0.707 : lx * 0.707 + ly * 0.707
      const ry = odd ? lx * 0.707 + ly * 0.707 : -lx * 0.707 + ly * 0.707
      const treadDist = Math.hypot(rx * 1.45, ry * 4.2)
      const tread = treadDist < 0.42 ? Math.max(0, 1 - treadDist / 0.42) : 0

      const grime = grimeLut[pIdx]
      const scratch = scratchLut[pIdx]
      const rustMask = rusted
        ? Math.max(0, Math.min(1, (grime - 0.44) * 2.5 + (scratch > 0.72 ? 0.25 : 0)))
        : Math.max(0, (grime - 0.66) * 1.4)

      let baseR = rusted ? 64 : 84
      let baseG = rusted ? 70 : 94
      let baseB = rusted ? 78 : 108

      baseR += tread * 32 - (1 - tread) * (grime * 18)
      baseG += tread * 34 - (1 - tread) * (grime * 18)
      baseB += tread * 36 - (1 - tread) * (grime * 16)

      baseR = baseR * (1 - rustMask) + 122 * rustMask
      baseG = baseG * (1 - rustMask) + 58 * rustMask
      baseB = baseB * (1 - rustMask) + 32 * rustMask

      colorData[idx] = clampByte(baseR)
      colorData[idx + 1] = clampByte(baseG)
      colorData[idx + 2] = clampByte(baseB)
      colorData[idx + 3] = 255

      const bumpVal = clampByte(88 + tread * 145 - grime * 28 + scratch * 18)
      bumpData[idx] = bumpVal
      bumpData[idx + 1] = bumpVal
      bumpData[idx + 2] = bumpVal
      bumpData[idx + 3] = 255

      const roughVal = clampByte(
        (rusted ? 190 : 128) - tread * 48 + rustMask * 65 + grime * 28
      )
      roughData[idx] = roughVal
      roughData[idx + 1] = roughVal
      roughData[idx + 2] = roughVal
      roughData[idx + 3] = 255
    }
  }

  return {
    map: configureDataTexture(
      new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat),
      { isColor: true, repeatX: 2, repeatY: 2 }
    ),
    bumpMap: configureDataTexture(
      new THREE.DataTexture(bumpData, size, size, THREE.RGBAFormat),
      { isColor: false, repeatX: 2, repeatY: 2 }
    ),
    roughnessMap: configureDataTexture(
      new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat),
      { isColor: false, repeatX: 2, repeatY: 2 }
    ),
  }
}

function buildPanelSteelTextures(size, rusted = false) {
  const colorData = new Uint8Array(size * size * 4)
  const bumpData = new Uint8Array(size * size * 4)
  const roughData = new Uint8Array(size * size * 4)
  const brushLut = buildFbmLut(size, 12, rusted ? 551 : 213)
  const dripLut = buildFbmLut(size, 8, rusted ? 773 : 331)
  const invSize = 1 / size

  for (let y = 0; y < size; y += 1) {
    const v = y * invSize
    const seamV = v < 0.025 || v > 0.975 || Math.abs(v - 0.5) < 0.014
    const rowOff = y * size
    const brushRowOff = (((y * 3) % size) * size)

    for (let x = 0; x < size; x += 1) {
      const u = x * invSize
      const pIdx = rowOff + x
      const idx = pIdx * 4

      const panelSeam =
        seamV || u < 0.028 || u > 0.972 || Math.abs(u - 0.5) < 0.015
      const brush = brushLut[brushRowOff + (x >> 1)]
      const drip = dripLut[(((y >> 1) * size) + ((x * 2) % size))]
      const rustAmount = rusted
        ? Math.max(0, Math.min(1, (drip - 0.38) * 2.1 + (panelSeam ? 0.35 : 0)))
        : Math.max(0, (drip - 0.72) * 1.1)

      let r = (rusted ? 66 : 86) + (brush - 0.5) * 22
      let g = (rusted ? 72 : 98) + (brush - 0.5) * 22
      let b = (rusted ? 80 : 112) + (brush - 0.5) * 24

      if (panelSeam) {
        r *= 0.62
        g *= 0.62
        b *= 0.64
      }

      r = r * (1 - rustAmount) + 118 * rustAmount
      g = g * (1 - rustAmount) + 55 * rustAmount
      b = b * (1 - rustAmount) + 30 * rustAmount

      colorData[idx] = clampByte(r)
      colorData[idx + 1] = clampByte(g)
      colorData[idx + 2] = clampByte(b)
      colorData[idx + 3] = 255

      const bumpVal = clampByte((panelSeam ? 65 : 138) + (brush - 0.5) * 42 - rustAmount * 45)
      bumpData[idx] = bumpVal
      bumpData[idx + 1] = bumpVal
      bumpData[idx + 2] = bumpVal
      bumpData[idx + 3] = 255

      const roughVal = clampByte((rusted ? 196 : 118) + rustAmount * 52 + (brush - 0.5) * 28)
      roughData[idx] = roughVal
      roughData[idx + 1] = roughVal
      roughData[idx + 2] = roughVal
      roughData[idx + 3] = 255
    }
  }

  return {
    map: configureDataTexture(
      new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat),
      { isColor: true }
    ),
    bumpMap: configureDataTexture(
      new THREE.DataTexture(bumpData, size, size, THREE.RGBAFormat),
      { isColor: false }
    ),
    roughnessMap: configureDataTexture(
      new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat),
      { isColor: false }
    ),
  }
}

function buildHazardStripeTexture(size, weathered = false) {
  const data = new Uint8Array(size * size * 4)
  const wearLut = buildFbmLut(size, 8, weathered ? 881 : 109)
  const invSize = 1 / size

  for (let y = 0; y < size; y += 1) {
    const v = y * invSize
    const rowOff = y * size
    for (let x = 0; x < size; x += 1) {
      const u = x * invSize
      const pIdx = rowOff + x
      const idx = pIdx * 4
      const stripe = (((u + v) * 6) % 1 + 1) % 1
      const isYellow = stripe < 0.5
      const wear = wearLut[pIdx]

      let r = isYellow ? (weathered ? 142 : 226) : 24
      let g = isYellow ? (weathered ? 102 : 168) : 27
      let b = isYellow ? (weathered ? 32 : 24) : 32

      if (weathered) {
        const chip = wear > 0.62 ? (wear - 0.62) * 2.1 : 0
        r = r * (1 - chip) + 74 * chip
        g = g * (1 - chip) + 46 * chip
        b = b * (1 - chip) + 30 * chip
      } else {
        const scuff = (wear - 0.5) * 18
        r += scuff
        g += scuff
        b += scuff
      }

      data[idx] = clampByte(r)
      data[idx + 1] = clampByte(g)
      data[idx + 2] = clampByte(b)
      data[idx + 3] = 255
    }
  }

  return configureDataTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), {
    isColor: true,
    repeatX: 2,
    repeatY: 1,
  })
}

function buildDustPuffTexture() {
  const size = 32
  const data = new Uint8Array(size * size * 4)
  const center = (size - 1) * 0.5
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - center) / center
      const dy = (y - center) / center
      const r = Math.hypot(dx, dy)
      const alpha = r >= 1 ? 0 : Math.pow(1 - r, 1.8)
      const idx = (y * size + x) * 4
      data[idx] = 212
      data[idx + 1] = 204
      data[idx + 2] = 192
      data[idx + 3] = clampByte(alpha * 225)
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  markSharedResource(tex)
  createdElevatorTextures.add(tex)
  return tex
}

let sharedDustTexture = null

function getSharedDustTexture() {
  if (!sharedDustTexture || !createdElevatorTextures.has(sharedDustTexture)) {
    sharedDustTexture = buildDustPuffTexture()
  }
  return sharedDustTexture
}

export function getElevatorTextureSet({ qualityPreset = 'high' } = {}) {
  const preset = normalizeQualityPreset(qualityPreset)
  let entry = elevatorTexturePool.get(preset)
  if (entry) return entry

  const size = getElevatorTextureSize(preset)
  entry = {
    preset,
    size,
    rustedDiamondPlate: buildDiamondPlateTextures(size, true),
    cleanDiamondPlate: buildDiamondPlateTextures(size, false),
    rustedSteel: buildPanelSteelTextures(size, true),
    cleanSteel: buildPanelSteelTextures(size, false),
    weatheredHazard: buildHazardStripeTexture(size, true),
    cleanHazard: buildHazardStripeTexture(size, false),
    dustPuff: getSharedDustTexture(),
  }
  elevatorTexturePool.set(preset, entry)
  return entry
}

export function disposeElevatorPools() {
  for (const tex of createdElevatorTextures) {
    tex?.dispose?.()
  }
  createdElevatorTextures.clear()
  elevatorTexturePool.clear()
  sharedDustTexture = null
}

export function getElevatorPoolStats() {
  return {
    presets: elevatorTexturePool.size,
    textures: createdElevatorTextures.size,
  }
}

registerSharedPoolClearer(disposeElevatorPools)
registerTextureAnisotropySyncer((maxAniso) => {
  const target = Math.max(1, Math.min(8, Math.floor(Number(maxAniso) || 1)))
  for (const tex of createdElevatorTextures) {
    if (tex && tex.anisotropy !== target) {
      tex.anisotropy = target
      tex.needsUpdate = true
    }
  }
})

/**
 * Resolves elevator facing yaw and which local sides (`front` = -Z, `rear` = +Z,
 * `left` = -X, `right` = +X) open onto walkable maze corridors (`CELL_TYPES.PATH`).
 */
export function resolveElevatorLayout(maze, cell) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || !cell) {
    return {
      yaw: 0,
      localSides: { front: true, rear: false, left: false, right: false },
    }
  }

  const { row, col } = cell
  const isPath = (r, c) => grid[r]?.[c] === CELL_TYPES.PATH

  // Match initial player facing order in MazeSceneEngine.setMaze():
  // East (+X), South (+Z), North (-Z), West (-X)
  let yaw = 0
  if (isPath(row, col + 1)) {
    yaw = -Math.PI / 2
  } else if (isPath(row + 1, col)) {
    yaw = Math.PI
  } else if (isPath(row - 1, col)) {
    yaw = 0
  } else if (isPath(row, col - 1)) {
    yaw = Math.PI / 2
  }

  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const localDirOpen = (lx, lz) => {
    const wx = lx * cos + lz * sin
    const wz = -lx * sin + lz * cos
    const dc = Math.round(wx)
    const dr = Math.round(wz)
    return isPath(row + dr, col + dc)
  }

  return {
    yaw,
    localSides: {
      front: localDirOpen(0, -1),
      rear: localDirOpen(0, 1),
      left: localDirOpen(-1, 0),
      right: localDirOpen(1, 0),
    },
  }
}

function getPlatformHeightAtCell(x, z, cell, maze, yaw) {
  const world = gridToWorld(cell.row, cell.col, maze)
  if (!world) return 0
  const dx = x - world.x
  const dz = z - world.z
  if (Math.abs(dx) > CELL_SIZE * 0.52 || Math.abs(dz) > CELL_SIZE * 0.52) {
    return 0
  }

  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const lx = dx * cos - dz * sin
  const lz = dx * sin + dz * cos

  const absX = Math.abs(lx)
  const absZ = Math.abs(lz)
  if (absX <= ELEVATOR_DECK_HALF_SPAN && absZ <= ELEVATOR_DECK_HALF_SPAN) {
    return ELEVATOR_DECK_TOP_Y
  }
  if (absX >= ELEVATOR_OUTER_BOUND || absZ >= ELEVATOR_OUTER_BOUND) {
    return 0
  }

  const tx = Math.max(0, (absX - ELEVATOR_DECK_HALF_SPAN) / ELEVATOR_RAMP_WIDTH)
  const tz = Math.max(0, (absZ - ELEVATOR_DECK_HALF_SPAN) / ELEVATOR_RAMP_WIDTH)
  const t = tx > tz ? tx : tz
  if (t >= 1) return 0
  return ELEVATOR_DECK_TOP_Y * (1 - t)
}

/**
 * Returns the exact floor height (0.06m on elevator steel decks, smoothly
 * tapering along beveled threshold ramps, 0 elsewhere) at world `(x, z)`.
 */
export function getElevatorFloorHeightAtWorld(x, z, maze) {
  if (!maze || !Number.isFinite(x) || !Number.isFinite(z)) {
    return 0
  }

  let height = 0
  if (maze.start) {
    const startYaw = resolveElevatorLayout(maze, maze.start).yaw
    const h = getPlatformHeightAtCell(x, z, maze.start, maze, startYaw)
    if (h > height) height = h
  }
  if (maze.exit) {
    const exitYaw = resolveElevatorLayout(maze, maze.exit).yaw
    const h = getPlatformHeightAtCell(x, z, maze.exit, maze, exitYaw)
    if (h > height) height = h
  }
  return height
}

/**
 * Generates collision descriptors for both elevator structural columns,
 * wall-backed bulkheads, and the extraction control cabinet without ever
 * blocking the player from exiting the starting elevator or entering the
 * extraction elevator (including across multi-open-neighbor braided layouts).
 */
export function getElevatorColliderDescriptors(maze) {
  if (!maze?.grid) return []
  const descriptors = []

  const buildShapesForCell = (localSides, includeControlConsole = false) => {
    const shapes = [
      // Four outer H-beam structural columns at corners (leaving >= 2.7m clear doorway)
      { kind: 'box', x: -1.66, z: -1.66, halfW: 0.13, halfD: 0.13 },
      { kind: 'box', x: 1.66, z: -1.66, halfW: 0.13, halfD: 0.13 },
      { kind: 'box', x: -1.66, z: 1.66, halfW: 0.13, halfD: 0.13 },
      { kind: 'box', x: 1.66, z: 1.66, halfW: 0.13, halfD: 0.13 },
    ]

    if (includeControlConsole) {
      // Industrial control pedestal nestled cleanly inside the front-left column footprint
      shapes.push({ kind: 'box', x: -1.44, z: -1.48, halfW: 0.12, halfD: 0.18 })
    }

    // Wall-backed cabin liner bulkheads ONLY on closed sides
    if (!localSides.rear) {
      shapes.push({ kind: 'box', x: 0, z: 1.76, halfW: 1.64, halfD: 0.11 })
    }
    if (!localSides.left) {
      shapes.push({ kind: 'box', x: -1.76, z: 0, halfW: 0.11, halfD: 1.64 })
    }
    if (!localSides.right) {
      shapes.push({ kind: 'box', x: 1.76, z: 0, halfW: 0.11, halfD: 1.64 })
    }
    if (!localSides.front) {
      shapes.push({ kind: 'box', x: 0, z: -1.76, halfW: 1.64, halfD: 0.11 })
    }

    return shapes
  }

  if (maze.start) {
    const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)
    if (startWorld) {
      const layout = resolveElevatorLayout(maze, maze.start)
      descriptors.push({
        propId: 'elevator-start-structure',
        propType: 'elevator_start',
        row: maze.start.row,
        col: maze.start.col,
        position: [startWorld.x, 0, startWorld.z],
        rotationYaw: layout.yaw,
        scale: 1,
        shapes: buildShapesForCell(layout.localSides, false),
      })
    }
  }

  if (maze.exit) {
    const exitWorld = gridToWorld(maze.exit.row, maze.exit.col, maze)
    if (exitWorld) {
      const layout = resolveElevatorLayout(maze, maze.exit)
      descriptors.push({
        propId: 'elevator-exit-structure',
        propType: 'elevator_exit',
        row: maze.exit.row,
        col: maze.exit.col,
        position: [exitWorld.x, 0, exitWorld.z],
        rotationYaw: layout.yaw,
        scale: 1,
        shapes: buildShapesForCell(layout.localSides, true),
      })
    }
  }

  return descriptors
}

function makeMesh(geometry, material, name, { castShadow = false, receiveShadow = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = castShadow
  mesh.receiveShadow = receiveShadow
  return mesh
}

function addHColumn(parent, { x, z, height, mat, gussetMat, prefix, index }) {
  const colGroup = new THREE.Group()
  colGroup.name = `${prefix}-column-${index}`
  colGroup.position.set(x, 0, z)

  // Footplate anchor
  const basePlate = makeMesh(
    new THREE.BoxGeometry(0.28, 0.04, 0.28),
    gussetMat,
    `${prefix}-column-base-${index}`
  )
  basePlate.position.y = 0.02
  colGroup.add(basePlate)

  // Core H-beam web + twin flanges
  const web = makeMesh(
    new THREE.BoxGeometry(0.06, height, 0.2),
    mat,
    `${prefix}-column-web-${index}`,
    { castShadow: true }
  )
  web.position.y = height / 2
  colGroup.add(web)

  for (let f = -1; f <= 1; f += 2) {
    const flange = makeMesh(
      new THREE.BoxGeometry(0.2, height, 0.04),
      mat,
      `${prefix}-column-flange-${index}-${f < 0 ? 'a' : 'b'}`,
      { castShadow: true }
    )
    flange.position.set(0, height / 2, f * 0.09)
    colGroup.add(flange)
  }

  parent.add(colGroup)
  return colGroup
}

function addRampApron(parent, side, width, thickness, material, name) {
  const rampLen = ELEVATOR_RAMP_WIDTH + 0.04
  const rampAngle = Math.atan2(ELEVATOR_DECK_TOP_Y - 0.004, ELEVATOR_RAMP_WIDTH)
  const geo =
    side === 'front' || side === 'rear'
      ? new THREE.BoxGeometry(width, thickness, rampLen)
      : new THREE.BoxGeometry(rampLen, thickness, width)
  const mesh = makeMesh(geo, material, name, { castShadow: false, receiveShadow: true })
  const midOffset = ELEVATOR_DECK_HALF_SPAN + ELEVATOR_RAMP_WIDTH * 0.5
  const midY = (ELEVATOR_DECK_TOP_Y - thickness * 0.5) * 0.5

  if (side === 'front') {
    mesh.position.set(0, midY, -midOffset)
    mesh.rotation.x = -rampAngle
  } else if (side === 'rear') {
    mesh.position.set(0, midY, midOffset)
    mesh.rotation.x = rampAngle
  } else if (side === 'left') {
    mesh.position.set(-midOffset, midY, 0)
    mesh.rotation.z = rampAngle
  } else {
    mesh.position.set(midOffset, midY, 0)
    mesh.rotation.z = -rampAngle
  }
  parent.add(mesh)
  return mesh
}

function addDroopingCable(parent, points, radius, segments, material, name) {
  const curve = new THREE.CatmullRomCurve3(points)
  const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false)
  const mesh = makeMesh(geo, material, name, { castShadow: false, receiveShadow: true })
  parent.add(mesh)
  return mesh
}

function updateTensionCableSpan(
  cables,
  cabY,
  anchorOffsetY,
  headAnchorY,
  vibrationJitter = 0,
  elapsedSec = 0,
  alwaysConnect = false
) {
  if (!Array.isArray(cables) || cables.length === 0) return
  const showFull = Boolean(alwaysConnect) || cabY > 0.015
  for (let i = 0; i < cables.length; i += 1) {
    const cable = cables[i]
    if (!cable) continue
    if (!showFull) {
      cable.scale.set(1, 0.24, 1)
      cable.position.y = anchorOffsetY + vibrationJitter
    } else {
      const bottomY = cabY + anchorOffsetY
      const span = Math.max(0.24, headAnchorY - bottomY)
      const jitter = vibrationJitter !== 0 ? Math.sin(elapsedSec * 36 + i * 1.4) * vibrationJitter : 0
      cable.scale.set(1, span, 1)
      cable.position.y = bottomY + span * 0.5 + jitter
    }
  }
}

function addThresholdCollar(parent, innerHalf, outerHalf, topY, thickness, material, prefix) {
  const band = Math.max(0.02, outerHalf - innerHalf)
  const fullLen = outerHalf * 2
  const innerSpan = innerHalf * 2
  const cy = topY - thickness * 0.5
  const mid = innerHalf + band * 0.5

  const front = makeMesh(new THREE.BoxGeometry(fullLen, thickness, band), material, `${prefix}-collar-front`)
  front.position.set(0, cy, -mid)
  parent.add(front)

  const rear = makeMesh(new THREE.BoxGeometry(fullLen, thickness, band), material, `${prefix}-collar-rear`)
  rear.position.set(0, cy, mid)
  parent.add(rear)

  const left = makeMesh(new THREE.BoxGeometry(band, thickness, innerSpan), material, `${prefix}-collar-left`)
  left.position.set(-mid, cy, 0)
  parent.add(left)

  const right = makeMesh(new THREE.BoxGeometry(band, thickness, innerSpan), material, `${prefix}-collar-right`)
  right.position.set(mid, cy, 0)
  parent.add(right)
}

/**
 * Builds the abandoned, broken industrial starting elevator platform anchored
 * at `(worldPos.x, 0, worldPos.z)` with a movable car cabin assembly (`cabinGroup`)
 * capable of descending smoothly down `maze-start-elevator-shaft` to `y = 0`.
 */
export function createBrokenStartElevator(
  worldPos,
  maze = null,
  { qualityPreset = 'high' } = {}
) {
  const group = new THREE.Group()
  group.name = 'maze-marker-start'
  group.position.set(worldPos.x, 0, worldPos.z)

  const layout = resolveElevatorLayout(maze, maze?.start)
  group.rotation.y = layout.yaw
  const { localSides } = layout

  const textures = getElevatorTextureSet({ qualityPreset })

  const startShaderOpts = {
    fadeStartY: ELEVATOR_SHAFT_CONFIG.depthFadeStartY,
    fadeEndY: ELEVATOR_SHAFT_CONFIG.depthFadeEndStartY,
    minVis: 0.004,
    baseBrightness: 0.72,
  }

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x9aa4b0,
    map: textures.rustedDiamondPlate.map,
    bumpMap: textures.rustedDiamondPlate.bumpMap,
    bumpScale: 0.036,
    roughnessMap: textures.rustedDiamondPlate.roughnessMap,
    roughness: 0.88,
    metalness: 0.58,
  })
  const cabDeckMat = applyShaftDepthDarknessShader(deckMat.clone(), startShaderOpts)

  const rustedBeamMat = new THREE.MeshStandardMaterial({
    color: 0x867a72,
    map: textures.rustedSteel.map,
    bumpMap: textures.rustedSteel.bumpMap,
    bumpScale: 0.03,
    roughnessMap: textures.rustedSteel.roughnessMap,
    roughness: 0.9,
    metalness: 0.45,
  })
  const cabRustedMat = applyShaftDepthDarknessShader(rustedBeamMat.clone(), startShaderOpts)

  const darkIronMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.steelDark,
    roughness: 0.86,
    metalness: 0.52,
  })
  const cabDarkIronMat = applyShaftDepthDarknessShader(darkIronMat.clone(), startShaderOpts)

  const rustAccentMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.rustMid,
    roughness: 0.94,
    metalness: 0.25,
  })
  const cabRustAccentMat = applyShaftDepthDarknessShader(rustAccentMat.clone(), startShaderOpts)

  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xb9aa96,
    map: textures.weatheredHazard,
    roughness: 0.85,
    metalness: 0.22,
  })

  const cableMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_PALETTE.cableSteel,
      roughness: 0.72,
      metalness: 0.68,
    }),
    startShaderOpts
  )

  const copperMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.copperWire,
    roughness: 0.45,
    metalness: 0.82,
  })

  const deadLampMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.deadLampGlass,
    emissive: 0x26150a,
    emissiveIntensity: 0.06,
    roughness: 0.55,
    metalness: 0.15,
  })

  // 1. Stationary shaft pit, sub-floor steel joists, threshold landing collar & ramps
  const pitPan = makeMesh(
    new THREE.BoxGeometry(2.96, 0.016, 2.96),
    darkIronMat,
    'start-elevator-pit-pan'
  )
  pitPan.position.y = 0.008
  group.add(pitPan)

  for (let j = -1; j <= 1; j += 1) {
    const joist = makeMesh(
      new THREE.BoxGeometry(2.86, 0.028, 0.09),
      rustAccentMat,
      `start-elevator-subjoist-${j + 1}`
    )
    joist.position.set(0, 0.022, j * 0.88)
    group.add(joist)
  }

  addThresholdCollar(
    group,
    1.305,
    ELEVATOR_DECK_HALF_SPAN,
    ELEVATOR_DECK_TOP_Y,
    0.036,
    deckMat,
    'start-elevator-landing'
  )

  const sideEntries = [
    ['front', localSides.front],
    ['rear', localSides.rear],
    ['left', localSides.left],
    ['right', localSides.right],
  ]
  for (let i = 0; i < sideEntries.length; i += 1) {
    const [sideName, isOpen] = sideEntries[i]
    if (isOpen) {
      addRampApron(
        group,
        sideName,
        2.56,
        0.028,
        deckMat,
        `start-elevator-ramp-${sideName}`
      )
    }
  }

  const frontSill = makeMesh(
    new THREE.BoxGeometry(2.54, 0.024, 0.14),
    hazardMat,
    'start-elevator-hazard-sill'
  )
  frontSill.position.set(0, ELEVATOR_DECK_TOP_Y - 0.009, -1.46)
  group.add(frontSill)

  // Outer stationary H-beam corridor framing columns & bulkheads
  const cornerCoords = [
    [-1.66, -1.66],
    [1.66, -1.66],
    [-1.66, 1.66],
    [1.66, 1.66],
  ]
  for (let i = 0; i < cornerCoords.length; i += 1) {
    addHColumn(group, {
      x: cornerCoords[i][0],
      z: cornerCoords[i][1],
      height: 2.58,
      mat: rustedBeamMat,
      gussetMat: rustAccentMat,
      prefix: 'start-elevator',
      index: i,
    })
  }

  const addClosedSidePanel = (sideName) => {
    const panelGroup = new THREE.Group()
    panelGroup.name = `start-elevator-bulkhead-${sideName}`
    if (sideName === 'rear') {
      panelGroup.position.set(0, 0, 1.72)
    } else if (sideName === 'left') {
      panelGroup.position.set(-1.72, 0, 0)
      panelGroup.rotation.y = Math.PI / 2
    } else if (sideName === 'right') {
      panelGroup.position.set(1.72, 0, 0)
      panelGroup.rotation.y = -Math.PI / 2
    } else {
      panelGroup.position.set(0, 0, -1.72)
      panelGroup.rotation.y = Math.PI
    }

    const lowerWall = makeMesh(
      new THREE.BoxGeometry(3.16, 1.18, 0.08),
      rustedBeamMat,
      `start-elevator-wall-${sideName}`,
      { castShadow: true }
    )
    lowerWall.position.y = 0.62
    panelGroup.add(lowerWall)

    const upperBar = makeMesh(
      new THREE.BoxGeometry(3.14, 0.06, 0.06),
      darkIronMat,
      `start-elevator-rail-${sideName}`
    )
    upperBar.position.set(0, 1.92, 0)
    if (sideName === 'right') {
      upperBar.rotation.z = -0.16
      upperBar.position.y = 1.72
    }
    panelGroup.add(upperBar)

    const handrail = makeMesh(
      new THREE.CylinderGeometry(0.028, 0.028, 2.55, 8),
      rustAccentMat,
      `start-elevator-handrail-${sideName}`
    )
    handrail.rotation.z = Math.PI / 2 + (sideName === 'left' ? 0.19 : 0)
    handrail.position.set(0, sideName === 'left' ? 0.94 : 1.06, -0.09)
    panelGroup.add(handrail)

    group.add(panelGroup)
  }

  for (let i = 0; i < sideEntries.length; i += 1) {
    const [sideName, isOpen] = sideEntries[i]
    if (!isOpen) addClosedSidePanel(sideName)
  }

  // Stationary broken landing portal doors, call panel & dead bulkhead lamps
  const doorHeaderTrack = makeMesh(
    new THREE.BoxGeometry(3.26, 0.14, 0.22),
    darkIronMat,
    'start-elevator-door-track',
    { castShadow: true }
  )
  doorHeaderTrack.position.set(0, 2.38, -1.52)
  doorHeaderTrack.rotation.z = -0.025
  group.add(doorHeaderTrack)

  const leftBrokenDoor = makeMesh(
    new THREE.BoxGeometry(0.36, 2.2, 0.09),
    rustedBeamMat,
    'start-elevator-broken-door-left',
    { castShadow: true }
  )
  leftBrokenDoor.position.set(-1.38, 1.18, -1.51)
  leftBrokenDoor.rotation.set(0.02, 0.18, -0.045)
  group.add(leftBrokenDoor)

  const rightBrokenDoor = makeMesh(
    new THREE.BoxGeometry(0.36, 2.18, 0.09),
    rustedBeamMat,
    'start-elevator-broken-door-right',
    { castShadow: true }
  )
  rightBrokenDoor.position.set(1.4, 1.16, -1.53)
  rightBrokenDoor.rotation.set(-0.03, -0.22, 0.055)
  group.add(rightBrokenDoor)

  const leftDoorWindowFrame = makeMesh(
    new THREE.BoxGeometry(0.16, 0.56, 0.11),
    darkIronMat,
    'start-elevator-broken-door-rib-left'
  )
  leftDoorWindowFrame.position.set(-1.38, 1.56, -1.51)
  leftDoorWindowFrame.rotation.copy(leftBrokenDoor.rotation)
  group.add(leftDoorWindowFrame)

  addDroopingCable(
    group,
    [
      new THREE.Vector3(-1.54, 2.26, -1.32),
      new THREE.Vector3(-1.42, 1.75, -1.16),
      new THREE.Vector3(-1.52, 1.36, -1.34),
    ],
    0.015,
    10,
    copperMat,
    'start-elevator-exposed-wiring'
  )

  const callPlate = makeMesh(
    new THREE.BoxGeometry(0.16, 0.28, 0.07),
    darkIronMat,
    'start-elevator-broken-call-panel'
  )
  callPlate.position.set(-1.52, 1.16, -1.52)
  callPlate.rotation.z = 0.09
  group.add(callPlate)

  for (let i = 0; i < 2; i += 1) {
    const sx = i === 0 ? -1.12 : 1.12
    const fixtureGroup = new THREE.Group()
    fixtureGroup.name = `start-elevator-dead-warning-light-${i}`
    fixtureGroup.position.set(sx, 2.38, -1.62)

    const housing = makeMesh(
      new THREE.BoxGeometry(0.18, 0.11, 0.1),
      darkIronMat,
      `start-elevator-lamp-housing-${i}`
    )
    fixtureGroup.add(housing)

    const glass = makeMesh(
      new THREE.CylinderGeometry(0.052, 0.052, 0.08, 10),
      deadLampMat,
      `start-elevator-lamp-dome-${i}`
    )
    glass.rotation.x = Math.PI / 2
    glass.position.z = -0.04
    fixtureGroup.add(glass)

    group.add(fixtureGroup)
  }

  // 2. Movable Starting Elevator Cabin Assembly (strictly <= ±1.31m XZ so travel clears ±1.54m shaft)
  const cabinGroup = new THREE.Group()
  cabinGroup.name = 'start-elevator-cabin'

  // Car platform decking (flush top = 0.06m when cabinGroup.position.y === 0)
  const mainDeck = makeMesh(
    new THREE.BoxGeometry(2.14, 0.036, 2.61),
    cabDeckMat,
    'start-elevator-deck-main'
  )
  mainDeck.position.set(-0.235, ELEVATOR_DECK_TOP_Y - 0.018, 0)
  cabinGroup.add(mainDeck)

  const sideDeck = makeMesh(
    new THREE.BoxGeometry(0.47, 0.036, 1.66),
    cabDeckMat,
    'start-elevator-deck-side'
  )
  sideDeck.position.set(1.07, ELEVATOR_DECK_TOP_Y - 0.018, -0.475)
  cabinGroup.add(sideDeck)

  const brokenGrate = makeMesh(
    new THREE.BoxGeometry(0.44, 0.022, 0.88),
    cabRustedMat,
    'start-elevator-damaged-grate'
  )
  brokenGrate.position.set(1.05, 0.036, 0.78)
  brokenGrate.rotation.set(0.08, 0.06, -0.14)
  cabinGroup.add(brokenGrate)

  const buckledPatch = makeMesh(
    new THREE.BoxGeometry(0.62, 0.016, 0.5),
    cabRustAccentMat,
    'start-elevator-buckled-plate'
  )
  buckledPatch.position.set(-0.88, ELEVATOR_DECK_TOP_Y + 0.006, 0.88)
  buckledPatch.rotation.set(-0.04, 0.09, 0.05)
  cabinGroup.add(buckledPatch)

  // Inner car corner stanchions + side/rear cage rails + guide rail shoes
  for (const cx of [-1.27, 1.27]) {
    for (const cz of [-1.27, 1.27]) {
      const stanchion = makeMesh(
        new THREE.BoxGeometry(0.06, 2.52, 0.06),
        cabDarkIronMat,
        `start-elevator-car-post-${cx < 0 ? 'w' : 'e'}${cz < 0 ? 'n' : 's'}`
      )
      stanchion.position.set(cx, 1.27, cz)
      cabinGroup.add(stanchion)
    }
  }
  for (const sx of [-1.28, 1.28]) {
    const railShoeBottom = makeMesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.14),
      cabDarkIronMat,
      `start-elevator-guide-shoe-bot-${sx < 0 ? 'left' : 'right'}`
    )
    railShoeBottom.position.set(sx < 0 ? -1.33 : 1.33, 0.16, 0)
    cabinGroup.add(railShoeBottom)

    const railShoeTop = makeMesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.14),
      cabDarkIronMat,
      `start-elevator-guide-shoe-top-${sx < 0 ? 'left' : 'right'}`
    )
    railShoeTop.position.set(sx < 0 ? -1.33 : 1.33, 2.48, 0)
    cabinGroup.add(railShoeTop)

    // Car side top tie beam
    const topTie = makeMesh(
      new THREE.BoxGeometry(0.07, 0.08, 2.58),
      cabRustedMat,
      `start-elevator-car-tie-${sx < 0 ? 'left' : 'right'}`
    )
    topTie.position.set(sx, 2.49, 0)
    cabinGroup.add(topTie)

    // Tucked inner car gate pockets moving coherently inside the cabin front frame
    const carGateLeaf = makeMesh(
      new THREE.BoxGeometry(0.14, 2.18, 0.045),
      cabRustedMat,
      `start-elevator-car-gate-${sx < 0 ? 'left' : 'right'}`,
      { castShadow: true }
    )
    carGateLeaf.position.set(sx < 0 ? -1.18 : 1.18, 1.16, -1.24)
    cabinGroup.add(carGateLeaf)
  }
  for (const [sideName, isOpen] of sideEntries) {
    if (isOpen || sideName === 'front') continue
    const kick = makeMesh(
      new THREE.BoxGeometry(sideName === 'rear' ? 2.54 : 0.04, 0.92, sideName === 'rear' ? 0.04 : 2.54),
      cabRustedMat,
      `start-elevator-car-kick-${sideName}`
    )
    if (sideName === 'rear') kick.position.set(0, 0.48, 1.28)
    else if (sideName === 'left') kick.position.set(-1.28, 0.48, 0)
    else kick.position.set(1.28, 0.48, 0)
    cabinGroup.add(kick)
  }

  // Tilted crosshead overhead girder + sheave + half-fallen roof grate inside cabinGroup
  const crossheadGroup = new THREE.Group()
  crossheadGroup.name = 'start-elevator-crosshead'
  crossheadGroup.position.set(0, 2.56, 0)
  crossheadGroup.rotation.z = -0.042

  const mainGirder = makeMesh(
    new THREE.BoxGeometry(2.68, 0.18, 0.32),
    cabRustedMat,
    'start-elevator-crosshead-beam',
    { castShadow: true }
  )
  crossheadGroup.add(mainGirder)

  for (let s = -1; s <= 1; s += 2) {
    const sideHeader = makeMesh(
      new THREE.BoxGeometry(0.12, 0.13, 2.58),
      cabDarkIronMat,
      `start-elevator-side-beam-${s < 0 ? 'left' : 'right'}`,
      { castShadow: true }
    )
    sideHeader.position.set(s * 1.27, -0.04, 0)
    crossheadGroup.add(sideHeader)
  }

  const sheaveWheel = makeMesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16),
    cabRustAccentMat,
    'start-elevator-sheave-wheel'
  )
  sheaveWheel.rotation.z = Math.PI / 2
  sheaveWheel.position.set(0.18, -0.02, 0.08)
  crossheadGroup.add(sheaveWheel)

  const sheaveBracket = makeMesh(
    new THREE.BoxGeometry(0.24, 0.24, 0.28),
    cabDarkIronMat,
    'start-elevator-sheave-housing'
  )
  sheaveBracket.position.set(0.18, 0.02, 0.08)
  crossheadGroup.add(sheaveBracket)

  const saggingRoofGrate = makeMesh(
    new THREE.BoxGeometry(0.68, 0.03, 0.68),
    cabDarkIronMat,
    'start-elevator-ceiling-grate'
  )
  saggingRoofGrate.position.set(-0.92, -0.14, 0.88)
  saggingRoofGrate.rotation.set(0.14, 0.05, 0.22)
  crossheadGroup.add(saggingRoofGrate)

  cabinGroup.add(crossheadGroup)

  // Snapped hoist cable tails & coiled scrap cable riding inside the broken car
  addDroopingCable(
    cabinGroup,
    [
      new THREE.Vector3(0.22, 2.48, 0.1),
      new THREE.Vector3(0.64, 1.72, 0.66),
      new THREE.Vector3(1.06, 0.65, 1.06),
      new THREE.Vector3(1.02, 0.09, 1.02),
    ],
    0.022,
    14,
    cableMat,
    'start-elevator-snapped-cable-1'
  )

  addDroopingCable(
    cabinGroup,
    [
      new THREE.Vector3(0.12, 2.48, 0.06),
      new THREE.Vector3(0.32, 1.92, 0.84),
      new THREE.Vector3(0.78, 0.92, 1.18),
      new THREE.Vector3(0.98, 0.08, 1.1),
    ],
    0.018,
    14,
    cableMat,
    'start-elevator-snapped-cable-2'
  )

  const cableCoil = makeMesh(
    new THREE.TorusGeometry(0.2, 0.024, 6, 16),
    cableMat,
    'start-elevator-cable-coil'
  )
  cableCoil.rotation.x = Math.PI / 2 - 0.08
  cableCoil.position.set(0.98, 0.085, 1.02)
  cabinGroup.add(cableCoil)

  group.add(cabinGroup)

  // Dynamic tension hoist cables connecting cab crosshead to upper shaft pulley frame (y = 14.9m)
  const tensionCables = []
  for (let i = 0; i < 2; i += 1) {
    const cx = i === 0 ? -0.34 : 0.34
    const tensionCable = makeMesh(
      new THREE.CylinderGeometry(0.016, 0.016, 1.0, 8),
      cableMat,
      `start-elevator-hoist-cable-${i}`
    )
    tensionCable.scale.set(1, 0.24, 1)
    tensionCable.position.set(cx, 2.58, -0.18)
    group.add(tensionCable)
    tensionCables.push(tensionCable)
  }

  // Pooled impact landing dust particle burst around threshold & pit (zero per-frame alloc)
  const dustCount = 28
  const dustPositions = new Float32Array(dustCount * 3)
  const dustVelocities = new Float32Array(dustCount * 3)
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
  const dustMat = new THREE.PointsMaterial({
    size: 0.24,
    map: textures.dustPuff,
    color: 0xa69b8d,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const dustPoints = new THREE.Points(dustGeo, dustMat)
  dustPoints.name = 'start-elevator-landing-dust'
  dustPoints.visible = false
  group.add(dustPoints)

  group.userData = {
    isStartElevator: true,
    localSides,
    yaw: layout.yaw,
    deckTopY: ELEVATOR_DECK_TOP_Y,
    cabinGroup,
    sheaveWheel,
    tensionCables,
    cableHeadAnchorY: 14.9,
    cableAnchorOffsetY: 2.58,
    startStage: 'idle',
    elevatorY: 0,
    vibrationY: 0,
    sheaveSpinAngle: 0,
    reducedMotion: false,
    dustPoints,
    dustGeo,
    dustMat,
    dustPositions,
    dustVelocities,
    dustTimer: 0,
    dustDuration: 0.85,
  }

  return group
}

export function setStartElevatorSequenceState(startGroup, state = {}) {
  if (!startGroup?.userData) return false
  const ud = startGroup.userData
  ud.startStage = typeof state.stage === 'string' ? state.stage : 'idle'
  if (Number.isFinite(state.elevatorY)) {
    ud.elevatorY = Math.max(0, state.elevatorY)
  } else if (ud.startStage === 'idle' || ud.startStage === 'completed') {
    ud.elevatorY = 0
  }
  if (Number.isFinite(state.vibrationY)) {
    ud.vibrationY = state.vibrationY
  } else if (ud.startStage === 'idle' || ud.startStage === 'completed') {
    ud.vibrationY = 0
  }
  if (state.reducedMotion !== undefined) {
    ud.reducedMotion = Boolean(state.reducedMotion)
  }

  const totalY = ud.elevatorY + (ud.reducedMotion ? 0 : ud.vibrationY)
  if (ud.cabinGroup) {
    ud.cabinGroup.position.y = totalY
  }
  updateTensionCableSpan(
    ud.tensionCables,
    totalY,
    ud.cableAnchorOffsetY ?? 2.58,
    ud.cableHeadAnchorY ?? 14.9,
    0,
    0,
    ud.startStage !== 'idle'
  )
  return true
}

export function getStartElevatorOffsetY(startGroup) {
  const ud = startGroup?.userData
  if (!ud) return 0
  return (ud.elevatorY || 0) + (ud.reducedMotion ? 0 : ud.vibrationY || 0)
}

export function triggerStartElevatorLandingDust(startGroup, { reducedMotion = false } = {}) {
  const ud = startGroup?.userData
  if (!ud?.dustPoints || !ud.dustPositions || !ud.dustVelocities || reducedMotion) {
    return false
  }
  const count = ud.dustPositions.length / 3
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.17
    const r = 1.15 + ((i * 37) % 10) * 0.025
    ud.dustPositions[i * 3] = Math.cos(angle) * r
    ud.dustPositions[i * 3 + 1] = 0.06 + (i % 4) * 0.03
    ud.dustPositions[i * 3 + 2] = Math.sin(angle) * r

    const speed = 1.1 + ((i * 19) % 10) * 0.13
    ud.dustVelocities[i * 3] = Math.cos(angle) * speed
    ud.dustVelocities[i * 3 + 1] = 0.55 + ((i * 23) % 10) * 0.08
    ud.dustVelocities[i * 3 + 2] = Math.sin(angle) * speed
  }
  const attr = ud.dustGeo.attributes.position
  if (attr) attr.needsUpdate = true
  ud.dustTimer = ud.dustDuration || 0.85
  ud.dustMat.opacity = 0.65
  ud.dustPoints.visible = true
  return true
}

export function updateStartElevator(startGroup, delta = 0.016, elapsedSec = 0) {
  const ud = startGroup?.userData
  if (!ud || !Number.isFinite(delta) || delta <= 0) return

  const stage = ud.startStage || 'idle'
  if (stage === 'elevator_descend' && !ud.reducedMotion) {
    ud.sheaveSpinAngle = (ud.sheaveSpinAngle || 0) + 5.6 * delta
    if (ud.sheaveWheel) {
      ud.sheaveWheel.rotation.x = ud.sheaveSpinAngle
    }
  } else if (stage === 'elevator_impact' && !ud.reducedMotion) {
    ud.sheaveSpinAngle = (ud.sheaveSpinAngle || 0) + 1.1 * delta
    if (ud.sheaveWheel) {
      ud.sheaveWheel.rotation.x = ud.sheaveSpinAngle
    }
  }

  const totalY = (ud.elevatorY || 0) + (ud.reducedMotion ? 0 : ud.vibrationY || 0)
  if (ud.cabinGroup) {
    ud.cabinGroup.position.y = totalY
  }
  const cableJitter =
    stage === 'elevator_descend' && !ud.reducedMotion
      ? 0.004
      : stage === 'elevator_impact' && !ud.reducedMotion
        ? 0.008
        : stage === 'elevator_settle' && !ud.reducedMotion
          ? 0.0015
          : 0
  updateTensionCableSpan(
    ud.tensionCables,
    totalY,
    ud.cableAnchorOffsetY ?? 2.58,
    ud.cableHeadAnchorY ?? 14.9,
    cableJitter,
    elapsedSec,
    stage !== 'idle'
  )

  if (ud.dustTimer > 0 && ud.dustPoints && ud.dustPositions && ud.dustVelocities) {
    ud.dustTimer = Math.max(0, ud.dustTimer - delta)
    const count = ud.dustPositions.length / 3
    const drag = Math.exp(-3.1 * delta)
    for (let i = 0; i < count; i += 1) {
      const ix = i * 3
      ud.dustVelocities[ix] *= drag
      ud.dustVelocities[ix + 1] = Math.max(-0.45, ud.dustVelocities[ix + 1] - 1.35 * delta)
      ud.dustVelocities[ix + 2] *= drag

      ud.dustPositions[ix] += ud.dustVelocities[ix] * delta
      ud.dustPositions[ix + 1] = Math.max(0.03, ud.dustPositions[ix + 1] + ud.dustVelocities[ix + 1] * delta)
      ud.dustPositions[ix + 2] += ud.dustVelocities[ix + 2] * delta
    }
    const attr = ud.dustGeo.attributes.position
    if (attr) attr.needsUpdate = true

    const fadeRatio = ud.dustTimer / Math.max(0.05, ud.dustDuration || 0.85)
    ud.dustMat.opacity = Math.max(0, Math.min(0.68, fadeRatio * 0.68))
    if (ud.dustTimer <= 0) {
      ud.dustPoints.visible = false
      ud.dustMat.opacity = 0
    }
  }
}

function smoothstepUnit(t) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return u * u * (3 - 2 * u)
}

function applyExtractionElevatorPalette(
  gateGroup,
  isLocked,
  intensityBoost = 0,
  sequenceVisual = null
) {
  if (!gateGroup?.userData) return
  const ud = gateGroup.userData
  const modeKey = sequenceVisual?.mode || (isLocked ? 'locked' : 'unlocked')
  const stateChanged = ud._appliedMode !== modeKey
  const intensityChanged =
    typeof ud._lastIntensityBoost !== 'number' ||
    Math.abs(ud._lastIntensityBoost - intensityBoost) > 1e-4
  const cabinIntensity = Number.isFinite(sequenceVisual?.cabinIntensity)
    ? sequenceVisual.cabinIntensity
    : isLocked
      ? 0.65
      : 1.05
  const cabinChanged =
    typeof ud._lastCabinIntensity !== 'number' ||
    Math.abs(ud._lastCabinIntensity - cabinIntensity) > 1e-4

  if (!stateChanged && !intensityChanged && !cabinChanged) {
    return
  }

  let accentHex = isLocked
    ? ELEVATOR_PALETTE.exitLockedAccent
    : ELEVATOR_PALETTE.exitUnlockedAccent
  let glowHex = isLocked
    ? ELEVATOR_PALETTE.exitLockedGlow
    : ELEVATOR_PALETTE.exitUnlockedGlow
  let cabinAccentHex = accentHex
  let cabinGlowHex = glowHex

  if (modeKey === 'extracting_amber') {
    accentHex = ELEVATOR_PALETTE.exitExtractingAccent
    glowHex = ELEVATOR_PALETTE.exitExtractingGlow
    cabinAccentHex = ELEVATOR_PALETTE.exitExtractingAccent
    cabinGlowHex = ELEVATOR_PALETTE.exitExtractingGlow
  } else if (modeKey === 'extracting_confirmed') {
    accentHex = ELEVATOR_PALETTE.exitUnlockedAccent
    glowHex = ELEVATOR_PALETTE.exitConfirmedGlow
    cabinAccentHex = ELEVATOR_PALETTE.exitUnlockedAccent
    cabinGlowHex = ELEVATOR_PALETTE.exitConfirmedGlow
  }

  if (ud.frameMat) {
    if (stateChanged) {
      ud.frameMat.color.setHex(accentHex)
      ud.frameMat.emissive.setHex(accentHex)
    }
    if (stateChanged || intensityChanged) {
      ud.frameMat.emissiveIntensity = (isLocked ? 0.52 : 0.72) + intensityBoost
    }
  }
  if (ud.beaconMat) {
    if (stateChanged) {
      ud.beaconMat.color.setHex(glowHex)
      ud.beaconMat.emissive.setHex(accentHex)
    }
    if (stateChanged || intensityChanged) {
      ud.beaconMat.emissiveIntensity = (isLocked ? 0.92 : 1.18) + intensityBoost
    }
  }
  if (ud.interiorLightMat) {
    if (stateChanged) {
      ud.interiorLightMat.color.setHex(cabinGlowHex)
      ud.interiorLightMat.emissive.setHex(cabinAccentHex)
    }
    if (stateChanged || cabinChanged) {
      ud.interiorLightMat.emissiveIntensity = cabinIntensity
    }
  }
  if (ud.statusMat) {
    if (stateChanged) {
      ud.statusMat.color.setHex(glowHex)
      ud.statusMat.emissive.setHex(accentHex)
      ud.statusMat.opacity = isLocked || modeKey !== 'unlocked' ? 0.92 : 0.72
    }
    if (stateChanged || intensityChanged) {
      ud.statusMat.emissiveIntensity = (isLocked ? 0.78 : 1.05) + intensityBoost
    }
  }

  ud._appliedLocked = isLocked
  ud._appliedMode = modeKey
  ud._lastIntensityBoost = intensityBoost
  ud._lastCabinIntensity = cabinIntensity
}

function syncExtractionDoorPositions(gateGroup, p) {
  const ud = gateGroup?.userData
  if (!ud?.doors) return
  // Bi-parting doors fitted strictly inside ±1.325m cab width so pockets clear shaft walls:
  // p=0 closed seam at center (±0.31 / ±0.91), p=1 open pockets tucked cleanly at (±0.96 / ±1.00)
  const innerX = 0.31 + p * 0.65
  const outerX = 0.91 + p * 0.09
  ud.doors.leftInner.position.x = -innerX
  ud.doors.rightInner.position.x = innerX
  ud.doors.leftOuter.position.x = -outerX
  ud.doors.rightOuter.position.x = outerX
}

export function setExtractionElevatorSequenceState(gateGroup, state = {}) {
  if (!gateGroup?.userData) return false
  const ud = gateGroup.userData
  const nextStage = typeof state.stage === 'string' ? state.stage : 'idle'
  ud.extractionStage = nextStage
  if (Number.isFinite(state.doorCloseProgress)) {
    ud.doorCloseProgress = Math.max(0, Math.min(1, state.doorCloseProgress))
  } else if (nextStage === 'idle') {
    ud.doorCloseProgress = 0
  }
  if (Number.isFinite(state.departureProgress)) {
    ud.departureProgress = Math.max(0, Math.min(1, state.departureProgress))
  } else if (nextStage === 'idle') {
    ud.departureProgress = 0
  }
  if (Number.isFinite(state.elevatorY)) {
    ud.elevatorY = Math.max(0, state.elevatorY)
  } else if (nextStage === 'idle') {
    ud.elevatorY = 0
  }
  if (state.reducedMotion !== undefined) {
    ud.reducedMotion = Boolean(state.reducedMotion)
  }
  if (nextStage === 'idle') {
    ud.deckOffsetY = 0
    ud.sheaveSpinAngle = 0
    if (ud.cabinGroup) {
      ud.cabinGroup.position.y = 0
    }
    updateTensionCableSpan(
      ud.tensionCables,
      0,
      ud.cableAnchorOffsetY ?? 2.62,
      ud.cableHeadAnchorY ?? 17.8,
      0,
      0,
      false
    )
    if (Array.isArray(ud.sheaves)) {
      for (let i = 0; i < ud.sheaves.length; i += 1) {
        ud.sheaves[i].rotation.x = 0
      }
    }
  } else {
    const immediateCabinY = (ud.elevatorY || 0) + (ud.deckOffsetY || 0)
    if (ud.cabinGroup) {
      ud.cabinGroup.position.y = immediateCabinY
    }
    updateTensionCableSpan(
      ud.tensionCables,
      immediateCabinY,
      ud.cableAnchorOffsetY ?? 2.62,
      ud.cableHeadAnchorY ?? 17.8,
      0,
      0,
      nextStage !== 'idle'
    )
  }
  return true
}

export function getExtractionDeckOffsetY(gateGroup) {
  return Number.isFinite(gateGroup?.userData?.deckOffsetY)
    ? gateGroup.userData.deckOffsetY
    : 0
}

export function getExtractionCabinY(gateGroup) {
  const ud = gateGroup?.userData
  if (!ud) return 0
  return (ud.elevatorY || 0) + (ud.deckOffsetY || 0)
}

export function setExtractionElevatorState(gateGroup, isLocked, options = {}) {
  if (!gateGroup?.userData) return false
  const ud = gateGroup.userData
  const nextLocked = Boolean(isLocked)
  const wasLocked = Boolean(ud.isLocked)
  ud.isLocked = nextLocked

  if (nextLocked || options.animate === false) {
    setExtractionElevatorSequenceState(gateGroup, {
      stage: 'idle',
      doorCloseProgress: 0,
      departureProgress: 0,
      elevatorY: 0,
    })
  }

  if (!nextLocked && wasLocked && options.animate !== false) {
    ud.unlockFlashTimer = 0.85
  } else if (options.animate === false) {
    ud.unlockFlashTimer = 0
    ud.unlockProgress = nextLocked ? 0 : 1
    syncExtractionDoorPositions(gateGroup, ud.unlockProgress)
    if (ud.lockBarGroup) {
      ud.lockBarGroup.visible = nextLocked
      ud.lockBarGroup.scale.set(Math.max(0.01, 1 - ud.unlockProgress), 1, 1)
    }
    ud._lastProgress = ud.unlockProgress
  }

  if (ud.lockBarGroup && (!ud.extractionStage || ud.extractionStage === 'idle')) {
    ud.lockBarGroup.visible = nextLocked || (ud.unlockProgress || 0) < 0.94
  }

  applyExtractionElevatorPalette(
    gateGroup,
    nextLocked,
    ud.unlockFlashTimer > 0 ? 0.7 : 0
  )
  return true
}

export function updateExtractionElevator(gateGroup, delta = 0.016, elapsedSec = 0) {
  if (!gateGroup?.userData || !Number.isFinite(delta) || delta <= 0) return
  const ud = gateGroup.userData
  const stage = ud.extractionStage || 'idle'

  if (!ud.isLocked && stage !== 'idle') {
    let p
    let showLockBar = false
    let lockBarScale = 0.01
    let deckOffsetY = 0
    let mode
    let intensityBoost
    let cabinIntensity

    if (stage === 'doors_closing') {
      const rawClose = Math.max(0, Math.min(1, ud.doorCloseProgress || 0))
      const doorCloseRatio = 0.72
      const doorSlideP = smoothstepUnit(Math.min(1, rawClose / doorCloseRatio))
      p = 1 - doorSlideP
      if (rawClose >= doorCloseRatio) {
        showLockBar = true
        const lockT = smoothstepUnit((rawClose - doorCloseRatio) / (1 - doorCloseRatio))
        lockBarScale = Math.max(0.02, lockT)
      }
      const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 9.5)
      mode = rawClose >= doorCloseRatio ? 'extracting_confirmed' : 'extracting_amber'
      intensityBoost = 0.22 + pulse * 0.55
      cabinIntensity = 1.38
    } else if (stage === 'departure_pause') {
      p = 0
      showLockBar = true
      lockBarScale = 1
      const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 12)
      mode = 'extracting_confirmed'
      intensityBoost = 0.65 + pulse * 0.45
      cabinIntensity = 1.56
    } else if (stage === 'departing' || stage === 'completed') {
      p = 0
      showLockBar = true
      lockBarScale = 1
      const depP = Math.max(0, Math.min(1, ud.departureProgress || 0))
      const spinSpeed =
        stage === 'departing'
          ? 2.8 + 7.2 * Math.sin(depP * Math.PI * 0.5)
          : 1.4
      ud.sheaveSpinAngle = (ud.sheaveSpinAngle || 0) + spinSpeed * delta
      if (Array.isArray(ud.sheaves)) {
        for (let i = 0; i < ud.sheaves.length; i += 1) {
          ud.sheaves[i].rotation.x = ud.sheaveSpinAngle
        }
      }

      if (!ud.reducedMotion) {
        const liftBase = Math.sin(depP * Math.PI * 0.5) * 0.016
        const rumble =
          stage === 'departing'
            ? Math.sin(elapsedSec * 31) * 0.0028 * Math.sin(depP * Math.PI)
            : 0
        deckOffsetY = Math.max(0, Math.min(0.022, liftBase + rumble))
      }

      // Attenuate interior and roof cabin light smoothly as the car climbs high into the dark shaft
      const cabAlt = ud.elevatorY || 0
      const depthDim =
        cabAlt <= 4.4
          ? 1.0
          : Math.max(0.14, 1 - Math.pow(Math.min(1, (cabAlt - 4.4) / 8.2), 1.45) * 0.86)

      if (depP < 0.22 && stage === 'departing') {
        const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 11)
        mode = 'extracting_amber'
        intensityBoost = (0.45 + pulse * 0.65) * depthDim
        cabinIntensity = 1.48 * depthDim
      } else {
        const confirmPulse = 0.5 + 0.5 * Math.sin(elapsedSec * 5.2)
        mode = 'extracting_confirmed'
        intensityBoost = (0.72 + confirmPulse * 0.48) * depthDim
        cabinIntensity = 1.62 * depthDim
      }
    } else {
      // Entering stages (approach_turn, walk_to_threshold, climb_threshold, enter_cabin, turn_and_settle)
      p = 1
      showLockBar = false
      const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 4.2)
      mode = 'unlocked'
      intensityBoost = 0.28 + pulse * 0.24
      cabinIntensity = 1.32
    }

    ud.deckOffsetY = deckOffsetY
    const totalCabinY = (ud.elevatorY || 0) + deckOffsetY
    if (ud.cabinGroup) {
      ud.cabinGroup.position.y = totalCabinY
    }
    const cableJitter =
      stage === 'departing' && !ud.reducedMotion
        ? 0.004
        : stage === 'departure_pause' && !ud.reducedMotion
          ? 0.002
          : 0
    updateTensionCableSpan(
      ud.tensionCables,
      totalCabinY,
      ud.cableAnchorOffsetY ?? 2.62,
      ud.cableHeadAnchorY ?? 17.8,
      cableJitter,
      elapsedSec,
      stage !== 'idle'
    )

    const progressChanged =
      typeof ud._lastProgress !== 'number' || Math.abs(p - ud._lastProgress) > 1e-5
    if (progressChanged) {
      syncExtractionDoorPositions(gateGroup, p)
      ud._lastProgress = p
    }
    if (ud.lockBarGroup) {
      if (ud.lockBarGroup.visible !== showLockBar) {
        ud.lockBarGroup.visible = showLockBar
      }
      if (showLockBar) {
        ud.lockBarGroup.scale.set(lockBarScale, 1, 1)
      }
    }

    applyExtractionElevatorPalette(gateGroup, false, Number(intensityBoost.toFixed(3)), {
      mode,
      cabinIntensity: Number(cabinIntensity.toFixed(3)),
    })
    return
  }

  ud.deckOffsetY = 0
  ud.elevatorY = 0
  if (ud.cabinGroup) {
    ud.cabinGroup.position.y = 0
  }
  updateTensionCableSpan(
    ud.tensionCables,
    0,
    ud.cableAnchorOffsetY ?? 2.62,
    ud.cableHeadAnchorY ?? 17.8,
    0,
    0,
    false
  )

  const prevProgress = ud.unlockProgress || 0

  if (ud.isLocked) {
    ud.unlockProgress = Math.max(0, prevProgress - delta * 4)
    ud.unlockFlashTimer = 0
  } else {
    ud.unlockProgress = Math.min(1, prevProgress + delta * 2.2)
    if (ud.unlockFlashTimer > 0) {
      ud.unlockFlashTimer = Math.max(0, ud.unlockFlashTimer - delta)
    }
  }

  const p = ud.unlockProgress
  const progressChanged =
    typeof ud._lastProgress !== 'number' || Math.abs(p - ud._lastProgress) > 1e-5

  if (progressChanged) {
    syncExtractionDoorPositions(gateGroup, p)
  }

  if (ud.lockBarGroup) {
    const showLockBar = ud.isLocked || p < 0.94
    if (ud.lockBarGroup.visible !== showLockBar) {
      ud.lockBarGroup.visible = showLockBar
    }
    if (showLockBar && progressChanged) {
      const retract = Math.max(0.01, 1 - p)
      ud.lockBarGroup.scale.set(retract, 1, 1)
    }
  }

  const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * (ud.isLocked ? 3.2 : 2.1))
  ud._lastProgress = p

  const flashIntensity =
    ud.unlockFlashTimer > 0
      ? (ud.unlockFlashTimer / 0.85) * 1.15
      : Number((pulse * 0.18).toFixed(3))
  applyExtractionElevatorPalette(gateGroup, ud.isLocked, flashIntensity)
}

/**
 * Builds the recognizable emergency industrial extraction elevator anchored at
 * `(worldPos.x, 0, worldPos.z)` with a stationary landing portal and a movable
 * `cabinGroup` assembly that ascends smoothly up `maze-exit-elevator-shaft`.
 */
export function createExtractionElevator(
  worldPos,
  maze = null,
  { qualityPreset = 'high' } = {}
) {
  const group = new THREE.Group()
  group.name = 'maze-marker-exit'
  group.position.set(worldPos.x, 0, worldPos.z)

  const layout = resolveElevatorLayout(maze, maze?.exit)
  group.rotation.y = layout.yaw
  const { localSides } = layout

  const textures = getElevatorTextureSet({ qualityPreset })

  const exitShaderOpts = {
    fadeStartY: ELEVATOR_SHAFT_CONFIG.depthFadeStartY,
    fadeEndY: ELEVATOR_SHAFT_CONFIG.depthFadeEndExitY,
    minVis: 0.008,
    baseBrightness: 1.0,
  }

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0xaab6c4,
    map: textures.cleanDiamondPlate.map,
    bumpMap: textures.cleanDiamondPlate.bumpMap,
    bumpScale: 0.03,
    roughnessMap: textures.cleanDiamondPlate.roughnessMap,
    roughness: 0.62,
    metalness: 0.72,
  })
  const cabDeckMat = applyShaftDepthDarknessShader(deckMat.clone(), exitShaderOpts)

  const claddingMat = new THREE.MeshStandardMaterial({
    color: 0xb7c2cf,
    map: textures.cleanSteel.map,
    bumpMap: textures.cleanSteel.bumpMap,
    bumpScale: 0.024,
    roughnessMap: textures.cleanSteel.roughnessMap,
    roughness: 0.54,
    metalness: 0.68,
  })
  const cabCladdingMat = applyShaftDepthDarknessShader(claddingMat.clone(), exitShaderOpts)

  const frameSteelMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.steelMid,
    roughness: 0.52,
    metalness: 0.74,
  })
  const cabFrameSteelMat = applyShaftDepthDarknessShader(frameSteelMat.clone(), exitShaderOpts)

  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.steelDark,
    roughness: 0.68,
    metalness: 0.58,
  })
  const cabDarkTrimMat = applyShaftDepthDarknessShader(darkTrimMat.clone(), exitShaderOpts)

  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.cleanHazard,
    roughness: 0.55,
    metalness: 0.25,
  })

  const doorSteelMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: 0x8f9dad,
      map: textures.cleanSteel.map,
      bumpMap: textures.cleanSteel.bumpMap,
      bumpScale: 0.022,
      roughness: 0.48,
      metalness: 0.78,
    }),
    exitShaderOpts
  )

  const doorWindowMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.glassTint,
    roughness: 0.16,
    metalness: 0.3,
    transparent: true,
    opacity: 0.74,
  })

  const cableMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_PALETTE.cableSteel,
      roughness: 0.58,
      metalness: 0.75,
    }),
    exitShaderOpts
  )

  const frameMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.exitUnlockedAccent,
    emissive: ELEVATOR_PALETTE.exitUnlockedAccent,
    emissiveIntensity: 0.72,
    roughness: 0.35,
    metalness: 0.3,
  })

  const beaconMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.exitUnlockedGlow,
    emissive: ELEVATOR_PALETTE.exitUnlockedAccent,
    emissiveIntensity: 1.18,
    roughness: 0.22,
    metalness: 0.3,
  })

  const interiorLightMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.exitUnlockedGlow,
    emissive: ELEVATOR_PALETTE.exitUnlockedAccent,
    emissiveIntensity: 1.05,
    roughness: 0.24,
    metalness: 0.2,
  })

  const statusMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.exitUnlockedGlow,
    emissive: ELEVATOR_PALETTE.exitUnlockedAccent,
    emissiveIntensity: 1.05,
    roughness: 0.25,
    metalness: 0.28,
    transparent: true,
    opacity: 0.72,
  })

  // 1. Stationary Corridor Landing Frame, Threshold Collar, Ramps, Outer Columns & Control Console
  const subChassis = makeMesh(
    new THREE.BoxGeometry(2.96, 0.026, 2.96),
    darkTrimMat,
    'extraction-elevator-subchassis'
  )
  subChassis.position.y = 0.013
  group.add(subChassis)

  addThresholdCollar(
    group,
    1.325,
    ELEVATOR_DECK_HALF_SPAN,
    ELEVATOR_DECK_TOP_Y,
    0.036,
    deckMat,
    'extraction-elevator-landing'
  )

  const thresholdSill = makeMesh(
    new THREE.BoxGeometry(2.58, 0.022, 0.16),
    hazardMat,
    'extraction-elevator-threshold-sill'
  )
  thresholdSill.position.set(0, ELEVATOR_DECK_TOP_Y - 0.009, -1.46)
  group.add(thresholdSill)

  const sideEntries = [
    ['front', localSides.front],
    ['rear', localSides.rear],
    ['left', localSides.left],
    ['right', localSides.right],
  ]
  for (let i = 0; i < sideEntries.length; i += 1) {
    const [sideName, isOpen] = sideEntries[i]
    if (isOpen) {
      addRampApron(
        group,
        sideName,
        2.56,
        0.028,
        deckMat,
        `extraction-elevator-ramp-${sideName}`
      )
    }
  }

  for (let s = -1; s <= 1; s += 2) {
    const bufferCyl = makeMesh(
      new THREE.CylinderGeometry(0.06, 0.07, 0.18, 10),
      darkTrimMat,
      `extraction-elevator-buffer-${s < 0 ? 'left' : 'right'}`
    )
    bufferCyl.position.set(s * 1.46, 0.09, 1.44)
    group.add(bufferCyl)
  }

  const cornerCoords = [
    [-1.66, -1.66],
    [1.66, -1.66],
    [-1.66, 1.66],
    [1.66, 1.66],
  ]
  for (let i = 0; i < cornerCoords.length; i += 1) {
    addHColumn(group, {
      x: cornerCoords[i][0],
      z: cornerCoords[i][1],
      height: 2.6,
      mat: frameSteelMat,
      gussetMat: darkTrimMat,
      prefix: 'extraction-elevator',
      index: i,
    })
  }

  const headerTransom = makeMesh(
    new THREE.BoxGeometry(3.54, 0.24, 0.36),
    darkTrimMat,
    'extraction-elevator-header',
    { castShadow: true }
  )
  headerTransom.position.set(0, 2.52, -1.56)
  group.add(headerTransom)

  const headerSignBar = makeMesh(
    new THREE.BoxGeometry(1.86, 0.09, 0.38),
    frameMat,
    'extraction-elevator-header-sign'
  )
  headerSignBar.position.set(0, 2.52, -1.56)
  group.add(headerSignBar)

  const rearBeam = makeMesh(
    new THREE.BoxGeometry(3.48, 0.16, 0.26),
    frameSteelMat,
    'extraction-elevator-rear-beam',
    { castShadow: true }
  )
  rearBeam.position.set(0, 2.54, 1.64)
  group.add(rearBeam)

  for (let s = -1; s <= 1; s += 2) {
    const sideTie = makeMesh(
      new THREE.BoxGeometry(0.16, 0.16, 3.24),
      frameSteelMat,
      `extraction-elevator-side-beam-${s < 0 ? 'left' : 'right'}`,
      { castShadow: true }
    )
    sideTie.position.set(s * 1.66, 2.54, 0)
    group.add(sideTie)
  }

  const addOuterCasingWall = (sideName) => {
    const wallGroup = new THREE.Group()
    wallGroup.name = `extraction-elevator-outer-casing-${sideName}`
    if (sideName === 'rear') {
      wallGroup.position.set(0, 0, 1.72)
    } else if (sideName === 'left') {
      wallGroup.position.set(-1.72, 0, 0)
      wallGroup.rotation.y = Math.PI / 2
    } else if (sideName === 'right') {
      wallGroup.position.set(1.72, 0, 0)
      wallGroup.rotation.y = -Math.PI / 2
    } else {
      wallGroup.position.set(0, 0, -1.72)
      wallGroup.rotation.y = Math.PI
    }
    const panel = makeMesh(
      new THREE.BoxGeometry(3.16, 2.42, 0.08),
      claddingMat,
      `extraction-elevator-outer-wall-${sideName}`,
      { castShadow: true }
    )
    panel.position.y = 1.24
    wallGroup.add(panel)
    group.add(wallGroup)
  }

  for (let i = 0; i < sideEntries.length; i += 1) {
    const [sideName, isOpen] = sideEntries[i]
    if (!isOpen) addOuterCasingWall(sideName)
  }

  const controlPanel = new THREE.Group()
  controlPanel.name = 'extraction-elevator-control-panel'
  controlPanel.position.set(-1.42, 0, -1.58)

  const consoleHousing = makeMesh(
    new THREE.BoxGeometry(0.24, 1.46, 0.26),
    darkTrimMat,
    'extraction-control-housing',
    { castShadow: true }
  )
  consoleHousing.position.y = 0.76
  controlPanel.add(consoleHousing)

  const consoleFaceplate = makeMesh(
    new THREE.BoxGeometry(0.18, 0.56, 0.04),
    frameSteelMat,
    'extraction-control-faceplate'
  )
  consoleFaceplate.position.set(0, 1.18, -0.13)
  controlPanel.add(consoleFaceplate)

  const consoleScreen = makeMesh(
    new THREE.BoxGeometry(0.12, 0.14, 0.025),
    statusMat,
    'extraction-control-status-screen'
  )
  consoleScreen.position.set(0, 1.32, -0.15)
  controlPanel.add(consoleScreen)

  const keycardSlot = makeMesh(
    new THREE.BoxGeometry(0.09, 0.07, 0.03),
    frameMat,
    'extraction-control-keycard-reader'
  )
  keycardSlot.position.set(0, 1.14, -0.15)
  controlPanel.add(keycardSlot)

  const callButtonBezel = makeMesh(
    new THREE.CylinderGeometry(0.032, 0.032, 0.03, 12),
    beaconMat,
    'extraction-control-call-button'
  )
  callButtonBezel.rotation.x = Math.PI / 2
  callButtonBezel.position.set(0, 0.99, -0.15)
  controlPanel.add(callButtonBezel)

  const consoleConduit = makeMesh(
    new THREE.CylinderGeometry(0.026, 0.026, 1.04, 8),
    cableMat,
    'extraction-control-conduit'
  )
  consoleConduit.position.set(0, 1.98, -0.02)
  controlPanel.add(consoleConduit)
  group.add(controlPanel)

  const beaconGlowGroup = new THREE.Group()
  beaconGlowGroup.name = 'extraction-elevator-emergency-beacons'
  for (let i = 0; i < 2; i += 1) {
    const sx = i === 0 ? -1.16 : 1.16
    const bGroup = new THREE.Group()
    bGroup.name = `extraction-emergency-beacon-${i}`
    bGroup.position.set(sx, 2.66, -1.58)

    const baseCollar = makeMesh(
      new THREE.CylinderGeometry(0.085, 0.095, 0.07, 12),
      darkTrimMat,
      `extraction-beacon-base-${i}`
    )
    bGroup.add(baseCollar)

    const bulbDome = makeMesh(
      new THREE.CylinderGeometry(0.062, 0.072, 0.11, 12),
      beaconMat,
      `extraction-beacon-dome-${i}`
    )
    bulbDome.position.y = 0.08
    bGroup.add(bulbDome)

    const protectiveRing = makeMesh(
      new THREE.TorusGeometry(0.082, 0.011, 6, 14),
      darkTrimMat,
      `extraction-beacon-cage-${i}`
    )
    protectiveRing.rotation.x = Math.PI / 2
    protectiveRing.position.y = 0.11
    bGroup.add(protectiveRing)

    beaconGlowGroup.add(bGroup)
  }
  group.add(beaconGlowGroup)

  addDroopingCable(
    group,
    [
      new THREE.Vector3(1.5, 2.48, 1.38),
      new THREE.Vector3(1.42, 1.54, 1.48),
      new THREE.Vector3(1.36, 0.72, 1.34),
      new THREE.Vector3(1.48, 0.12, 1.44),
    ],
    0.024,
    14,
    cableMat,
    'extraction-elevator-traveler-cable'
  )

  // 2. Movable Industrial Extraction Cabin Assembly (<= ±1.33m XZ, rises smoothly inside ±1.54m shaft)
  const cabinGroup = new THREE.Group()
  cabinGroup.name = 'extraction-elevator-cabin'

  const platformDeck = makeMesh(
    new THREE.BoxGeometry(2.65, 0.036, 2.65),
    cabDeckMat,
    'extraction-elevator-platform'
  )
  platformDeck.position.y = ELEVATOR_DECK_TOP_Y - 0.018
  cabinGroup.add(platformDeck)

  const thresholdGlowStrip = makeMesh(
    new THREE.BoxGeometry(2.16, 0.012, 0.055),
    frameMat,
    'extraction-elevator-sill-strip'
  )
  thresholdGlowStrip.position.set(0, ELEVATOR_DECK_TOP_Y + 0.002, -1.24)
  cabinGroup.add(thresholdGlowStrip)

  // Corner car structural stiles & guide rail shoes riding the shaft rails
  for (const cx of [-1.28, 1.28]) {
    for (const cz of [-1.28, 1.28]) {
      const stile = makeMesh(
        new THREE.BoxGeometry(0.08, 2.52, 0.08),
        cabFrameSteelMat,
        `extraction-elevator-car-stile-${cx < 0 ? 'w' : 'e'}${cz < 0 ? 'n' : 's'}`
      )
      stile.position.set(cx, 1.27, cz)
      cabinGroup.add(stile)
    }
  }
  for (const sx of [-1, 1]) {
    const shoeBot = makeMesh(
      new THREE.BoxGeometry(0.14, 0.16, 0.14),
      cabDarkTrimMat,
      `extraction-elevator-guide-shoe-bot-${sx < 0 ? 'left' : 'right'}`
    )
    shoeBot.position.set(sx * 1.34, 0.16, 0)
    cabinGroup.add(shoeBot)

    const shoeTop = makeMesh(
      new THREE.BoxGeometry(0.14, 0.16, 0.14),
      cabDarkTrimMat,
      `extraction-elevator-guide-shoe-top-${sx < 0 ? 'left' : 'right'}`
    )
    shoeTop.position.set(sx * 1.34, 2.52, 0)
    cabinGroup.add(shoeTop)
  }

  // Open perimeter skylight / hatch ceiling frame inside cabinGroup leaving center sightline open
  const cabinCeiling = new THREE.Group()
  cabinCeiling.name = 'extraction-elevator-ceiling-deck'
  cabinCeiling.position.set(0, 2.52, 0)
  const collarStripSpecs = [
    { cx: 0, cz: -1.18, sx: 2.64, sz: 0.28, label: 'front' },
    { cx: 0, cz: 1.18, sx: 2.64, sz: 0.28, label: 'rear' },
    { cx: -1.18, cz: 0, sx: 0.28, sz: 2.08, label: 'left' },
    { cx: 1.18, cz: 0, sx: 0.28, sz: 2.08, label: 'right' },
  ]
  for (let i = 0; i < collarStripSpecs.length; i += 1) {
    const spec = collarStripSpecs[i]
    const bar = makeMesh(
      new THREE.BoxGeometry(spec.sx, 0.07, spec.sz),
      cabDarkTrimMat,
      `extraction-elevator-ceiling-deck-${spec.label}`
    )
    bar.position.set(spec.cx, 0, spec.cz)
    cabinCeiling.add(bar)
  }
  cabinGroup.add(cabinCeiling)

  const interiorLightStrip = makeMesh(
    new THREE.BoxGeometry(1.72, 0.04, 0.14),
    interiorLightMat,
    'extraction-elevator-cabin-light'
  )
  interiorLightStrip.position.set(0, 2.46, 1.18)
  cabinGroup.add(interiorLightStrip)

  // Overhead departure status bar mounted on moving cab header
  const cabRoofBeaconBar = makeMesh(
    new THREE.BoxGeometry(1.56, 0.055, 0.07),
    beaconMat,
    'extraction-elevator-cab-roof-beacon'
  )
  cabRoofBeaconBar.position.set(0, 2.58, -1.18)
  cabinGroup.add(cabRoofBeaconBar)

  // Overhead winch assembly + dual grooved sheaves riding on cab crosshead
  const winchCrossbar = makeMesh(
    new THREE.BoxGeometry(1.12, 0.14, 0.26),
    cabFrameSteelMat,
    'extraction-elevator-winch-mount'
  )
  winchCrossbar.position.set(0, 2.61, 0)
  cabinGroup.add(winchCrossbar)

  const sheaves = []
  for (let s = -1; s <= 1; s += 2) {
    const sheave = makeMesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.07, 14),
      cabDarkTrimMat,
      `extraction-elevator-sheave-${s < 0 ? 'left' : 'right'}`
    )
    sheave.rotation.z = Math.PI / 2
    sheave.position.set(s * 0.34, 2.62, 0)
    cabinGroup.add(sheave)
    sheaves.push(sheave)
  }

  // Inner moving cabin walls & grab rails on closed sides
  const addCabinWall = (sideName) => {
    const wallGroup = new THREE.Group()
    wallGroup.name = `extraction-elevator-cabin-wall-${sideName}`
    if (sideName === 'rear') {
      wallGroup.position.set(0, 0, 1.3)
    } else if (sideName === 'left') {
      wallGroup.position.set(-1.3, 0, 0)
      wallGroup.rotation.y = Math.PI / 2
    } else if (sideName === 'right') {
      wallGroup.position.set(1.3, 0, 0)
      wallGroup.rotation.y = -Math.PI / 2
    } else {
      wallGroup.position.set(0, 0, -1.3)
      wallGroup.rotation.y = Math.PI
    }

    const panel = makeMesh(
      new THREE.BoxGeometry(2.56, 2.42, 0.055),
      cabCladdingMat,
      `extraction-elevator-wall-panel-${sideName}`,
      { castShadow: true }
    )
    panel.position.y = 1.24
    wallGroup.add(panel)

    for (let b = -1; b <= 1; b += 2) {
      const batten = makeMesh(
        new THREE.BoxGeometry(0.06, 2.38, 0.08),
        cabDarkTrimMat,
        `extraction-elevator-batten-${sideName}-${b < 0 ? 'a' : 'b'}`
      )
      batten.position.set(b * 0.82, 1.24, -0.02)
      wallGroup.add(batten)
    }

    const rail = makeMesh(
      new THREE.CylinderGeometry(0.026, 0.026, 2.18, 8),
      cabFrameSteelMat,
      `extraction-elevator-grab-rail-${sideName}`
    )
    rail.rotation.z = Math.PI / 2
    rail.position.set(0, 1.02, -0.08)
    wallGroup.add(rail)

    if (sideName === 'rear') {
      const rearArrowStrip = makeMesh(
        new THREE.BoxGeometry(1.32, 0.08, 0.03),
        frameMat,
        'extraction-elevator-rear-beacon-bar'
      )
      rearArrowStrip.position.set(0, 1.98, -0.04)
      wallGroup.add(rearArrowStrip)
    }

    cabinGroup.add(wallGroup)
  }

  for (let i = 0; i < sideEntries.length; i += 1) {
    const [sideName, isOpen] = sideEntries[i]
    if (!isOpen) addCabinWall(sideName)
  }

  // Heavy Telescoping Bi-Parting Sliding Doors riding WITH the cabin (strictly inside ±1.32m)
  const doorsGroup = new THREE.Group()
  doorsGroup.name = 'extraction-elevator-doors'

  const makeDoorLeaf = (name, zOffset, hasWindow = true) => {
    const leaf = new THREE.Group()
    leaf.name = name

    const slab = makeMesh(
      new THREE.BoxGeometry(0.64, 2.26, 0.055),
      doorSteelMat,
      `${name}-panel`,
      { castShadow: true }
    )
    slab.position.y = 1.19
    leaf.add(slab)

    const rib = makeMesh(
      new THREE.BoxGeometry(0.62, 0.12, 0.07),
      cabDarkTrimMat,
      `${name}-kickplate`
    )
    rib.position.y = 0.24
    leaf.add(rib)

    if (hasWindow) {
      const windowPane = makeMesh(
        new THREE.BoxGeometry(0.14, 0.58, 0.068),
        doorWindowMat,
        `${name}-viewport`
      )
      windowPane.position.y = 1.56
      leaf.add(windowPane)
    }

    leaf.position.z = zOffset
    doorsGroup.add(leaf)
    return leaf
  }

  const leftInner = makeDoorLeaf('extraction-door-left-inner', -1.23, true)
  const rightInner = makeDoorLeaf('extraction-door-right-inner', -1.23, true)
  const leftOuter = makeDoorLeaf('extraction-door-left-outer', -1.29, false)
  const rightOuter = makeDoorLeaf('extraction-door-right-outer', -1.29, false)
  const doors = { leftInner, rightInner, leftOuter, rightOuter }

  // Electromagnetic security crossbar riding inside moving cabinGroup
  const lockBarGroup = new THREE.Group()
  lockBarGroup.name = 'extraction-elevator-lock-bar'
  lockBarGroup.position.set(0, 1.24, -1.17)

  const lockBeam = makeMesh(
    new THREE.BoxGeometry(2.26, 0.11, 0.075),
    cabDarkTrimMat,
    'extraction-lock-beam'
  )
  lockBarGroup.add(lockBeam)

  const lockSealCore = makeMesh(
    new THREE.BoxGeometry(0.42, 0.16, 0.1),
    statusMat,
    'extraction-lock-status-core'
  )
  lockBarGroup.add(lockSealCore)

  lockBarGroup.visible = false
  cabinGroup.add(doorsGroup)
  cabinGroup.add(lockBarGroup)
  group.add(cabinGroup)

  // Live Vertical Tension Hoist Cables anchored from cab sheaves up to shaft traction machine (y = 17.8m)
  const tensionCables = []
  for (let i = 0; i < 2; i += 1) {
    const cx = i === 0 ? -0.34 : 0.34
    const tensionCable = makeMesh(
      new THREE.CylinderGeometry(0.016, 0.016, 1.0, 8),
      cableMat,
      `extraction-elevator-hoist-cable-${i}`
    )
    tensionCable.scale.set(1, 0.24, 1)
    tensionCable.position.set(cx, 2.58, 0.04)
    group.add(tensionCable)
    tensionCables.push(tensionCable)
  }

  group.userData = {
    isExitGate: true,
    isExitElevator: true,
    isLocked: false,
    unlockProgress: 1,
    unlockFlashTimer: 0,
    frameMat,
    beaconMat,
    interiorLightMat,
    statusMat,
    portalMat: statusMat,
    doors,
    doorsGroup,
    lockBarGroup,
    controlPanel,
    beaconGlowGroup,
    cabinGroup,
    platformDeck,
    basePlatformDeckY: ELEVATOR_DECK_TOP_Y - 0.018,
    sheaves,
    tensionCables,
    cableHeadAnchorY: 17.8,
    cableAnchorOffsetY: 2.62,
    localSides,
    yaw: layout.yaw,
    deckTopY: ELEVATOR_DECK_TOP_Y,
    extractionStage: 'idle',
    doorCloseProgress: 0,
    departureProgress: 0,
    elevatorY: 0,
    reducedMotion: false,
    sheaveSpinAngle: 0,
    deckOffsetY: 0,
  }

  syncExtractionDoorPositions(group, 1)
  return group
}
