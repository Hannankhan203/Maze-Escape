import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import {
  markSharedResource,
  registerSharedPoolClearer,
  registerTextureAnisotropySyncer,
} from './sharedResources.js'

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

/**
 * Builds the abandoned, broken industrial starting elevator platform anchored
 * at `(worldPos.x, 0, worldPos.z)` with deck surface strictly at `y = 0.06m`.
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

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x9aa4b0,
    map: textures.rustedDiamondPlate.map,
    bumpMap: textures.rustedDiamondPlate.bumpMap,
    bumpScale: 0.036,
    roughnessMap: textures.rustedDiamondPlate.roughnessMap,
    roughness: 0.88,
    metalness: 0.58,
  })

  const rustedBeamMat = new THREE.MeshStandardMaterial({
    color: 0x867a72,
    map: textures.rustedSteel.map,
    bumpMap: textures.rustedSteel.bumpMap,
    bumpScale: 0.03,
    roughnessMap: textures.rustedSteel.roughnessMap,
    roughness: 0.9,
    metalness: 0.45,
  })

  const darkIronMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.steelDark,
    roughness: 0.86,
    metalness: 0.52,
  })

  const rustAccentMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.rustMid,
    roughness: 0.94,
    metalness: 0.25,
  })

  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xb9aa96,
    map: textures.weatheredHazard,
    roughness: 0.85,
    metalness: 0.22,
  })

  const cableMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.cableSteel,
    roughness: 0.72,
    metalness: 0.68,
  })

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

  // 1. Dark recessed shaft pit + rusted sub-floor steel joists
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

  // 2. Damaged diamond-plate elevator flooring (flush top = 0.06m under player spawn)
  const mainDeck = makeMesh(
    new THREE.BoxGeometry(2.36, 0.036, 2.88),
    deckMat,
    'start-elevator-deck-main'
  )
  mainDeck.position.set(-0.26, ELEVATOR_DECK_TOP_Y - 0.018, 0)
  group.add(mainDeck)

  // Right-front intact strip, leaving back-right corner bay damaged with fallen grate
  const sideDeck = makeMesh(
    new THREE.BoxGeometry(0.54, 0.036, 1.72),
    deckMat,
    'start-elevator-deck-side'
  )
  sideDeck.position.set(1.17, ELEVATOR_DECK_TOP_Y - 0.018, -0.58)
  group.add(sideDeck)

  // Warped / snapped grate hanging into the back-right pit bay (y < 0.055 so never trips center spawn)
  const brokenGrate = makeMesh(
    new THREE.BoxGeometry(0.5, 0.022, 0.96),
    rustedBeamMat,
    'start-elevator-damaged-grate'
  )
  brokenGrate.position.set(1.14, 0.036, 0.82)
  brokenGrate.rotation.set(0.08, 0.06, -0.14)
  group.add(brokenGrate)

  // Buckled / torn corner deck patch along rear-left edge
  const buckledPatch = makeMesh(
    new THREE.BoxGeometry(0.66, 0.016, 0.54),
    rustAccentMat,
    'start-elevator-buckled-plate'
  )
  buckledPatch.position.set(-0.96, ELEVATOR_DECK_TOP_Y + 0.006, 1.02)
  buckledPatch.rotation.set(-0.04, 0.09, 0.05)
  group.add(buckledPatch)

  // Threshold hazard sill & ramp aprons on open corridor edges
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

  // 3. Structural corner H-columns + diagonal gussets + tilted crosshead beam + sheave
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

  // Crosshead overhead girder tilted slightly as if dropped on one guide shoe
  const crossheadGroup = new THREE.Group()
  crossheadGroup.name = 'start-elevator-crosshead'
  crossheadGroup.position.set(0, 2.56, 0)
  crossheadGroup.rotation.z = -0.042

  const mainGirder = makeMesh(
    new THREE.BoxGeometry(3.48, 0.18, 0.34),
    rustedBeamMat,
    'start-elevator-crosshead-beam',
    { castShadow: true }
  )
  crossheadGroup.add(mainGirder)

  // Top tie-beams bridging front & rear columns
  for (let s = -1; s <= 1; s += 2) {
    const sideHeader = makeMesh(
      new THREE.BoxGeometry(0.14, 0.14, 3.24),
      darkIronMat,
      `start-elevator-side-beam-${s < 0 ? 'left' : 'right'}`,
      { castShadow: true }
    )
    sideHeader.position.set(s * 1.66, -0.04, 0)
    crossheadGroup.add(sideHeader)
  }

  // Rusted overhead hoist sheave pulley wheel
  const sheaveWheel = makeMesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16),
    rustAccentMat,
    'start-elevator-sheave-wheel'
  )
  sheaveWheel.rotation.z = Math.PI / 2
  sheaveWheel.position.set(0.18, -0.02, 0.08)
  crossheadGroup.add(sheaveWheel)

  const sheaveBracket = makeMesh(
    new THREE.BoxGeometry(0.24, 0.24, 0.28),
    darkIronMat,
    'start-elevator-sheave-housing'
  )
  sheaveBracket.position.set(0.18, 0.02, 0.08)
  crossheadGroup.add(sheaveBracket)

  // Bent / half-fallen ceiling grate inside top frame
  const saggingRoofGrate = makeMesh(
    new THREE.BoxGeometry(1.42, 0.03, 1.32),
    darkIronMat,
    'start-elevator-ceiling-grate'
  )
  saggingRoofGrate.position.set(-0.54, -0.14, 0.42)
  saggingRoofGrate.rotation.set(0.12, 0.05, 0.18)
  crossheadGroup.add(saggingRoofGrate)

  group.add(crossheadGroup)

  // 4. Wall-backed rusted cage walls & broken guardrails ONLY on closed sides
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

    // Upper industrial mesh frame (2 horizontal bars + broken vertical bar)
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

  // 5. Broken, jammed-open elevator doors along front portal (leaving > 2.2m clear exit)
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

  // Crooked door reinforcement ribs
  const leftDoorWindowFrame = makeMesh(
    new THREE.BoxGeometry(0.16, 0.56, 0.11),
    darkIronMat,
    'start-elevator-broken-door-rib-left'
  )
  leftDoorWindowFrame.position.set(-1.38, 1.56, -1.51)
  leftDoorWindowFrame.rotation.copy(leftBrokenDoor.rotation)
  group.add(leftDoorWindowFrame)

  // 6. Exposed snapped hoist cables, floor scrap coil & severed electrical conduit
  addDroopingCable(
    group,
    [
      new THREE.Vector3(0.22, 2.48, 0.1),
      new THREE.Vector3(0.68, 1.72, 0.72),
      new THREE.Vector3(1.18, 0.65, 1.18),
      new THREE.Vector3(1.14, 0.09, 1.12),
    ],
    0.022,
    14,
    cableMat,
    'start-elevator-snapped-cable-1'
  )

  addDroopingCable(
    group,
    [
      new THREE.Vector3(0.12, 2.48, 0.06),
      new THREE.Vector3(0.34, 1.92, 0.92),
      new THREE.Vector3(0.86, 0.92, 1.38),
      new THREE.Vector3(1.06, 0.08, 1.24),
    ],
    0.018,
    14,
    cableMat,
    'start-elevator-snapped-cable-2'
  )

  // Coiled scrap cable resting in back-right pit bay
  const cableCoil = makeMesh(
    new THREE.TorusGeometry(0.22, 0.024, 6, 16),
    cableMat,
    'start-elevator-cable-coil'
  )
  cableCoil.rotation.x = Math.PI / 2 - 0.08
  cableCoil.position.set(1.08, 0.085, 1.16)
  group.add(cableCoil)

  // Exposed drooping conduit with stripped copper tips from left column
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

  // 7. Broken call-button faceplate & dead unpowered warning bulkhead lamps
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

  group.userData = {
    isStartElevator: true,
    localSides,
    yaw: layout.yaw,
    deckTopY: ELEVATOR_DECK_TOP_Y,
  }

  return group
}

function applyExtractionElevatorPalette(gateGroup, isLocked, intensityBoost = 0) {
  if (!gateGroup?.userData) return
  const ud = gateGroup.userData
  const stateChanged = ud._appliedLocked !== isLocked
  const intensityChanged =
    typeof ud._lastIntensityBoost !== 'number' ||
    Math.abs(ud._lastIntensityBoost - intensityBoost) > 1e-4

  if (!stateChanged && !intensityChanged) {
    return
  }

  const accentHex = isLocked
    ? ELEVATOR_PALETTE.exitLockedAccent
    : ELEVATOR_PALETTE.exitUnlockedAccent
  const glowHex = isLocked
    ? ELEVATOR_PALETTE.exitLockedGlow
    : ELEVATOR_PALETTE.exitUnlockedGlow

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
  if (ud.statusMat) {
    if (stateChanged) {
      ud.statusMat.color.setHex(glowHex)
      ud.statusMat.emissive.setHex(accentHex)
      ud.statusMat.opacity = isLocked ? 0.92 : 0.72
    }
    if (stateChanged || intensityChanged) {
      ud.statusMat.emissiveIntensity = (isLocked ? 0.78 : 1.05) + intensityBoost
    }
  }

  ud._appliedLocked = isLocked
  ud._lastIntensityBoost = intensityBoost
}

function syncExtractionDoorPositions(gateGroup, p) {
  const ud = gateGroup?.userData
  if (!ud?.doors) return
  // Bi-parting heavy doors: p=0 closed at center (±0.54 / ±1.06), p=1 tucked cleanly into ±1.28..±1.38 pockets
  const innerX = 0.54 + p * 0.74
  const outerX = 1.06 + p * 0.32
  ud.doors.leftInner.position.x = -innerX
  ud.doors.rightInner.position.x = innerX
  ud.doors.leftOuter.position.x = -outerX
  ud.doors.rightOuter.position.x = outerX
}

export function setExtractionElevatorState(gateGroup, isLocked, options = {}) {
  if (!gateGroup?.userData) return false
  const ud = gateGroup.userData
  const nextLocked = Boolean(isLocked)
  const wasLocked = Boolean(ud.isLocked)
  ud.isLocked = nextLocked

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

  if (ud.lockBarGroup) {
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
 * `(worldPos.x, 0, worldPos.z)` with deck top at `y = 0.06m`.
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

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0xaab6c4,
    map: textures.cleanDiamondPlate.map,
    bumpMap: textures.cleanDiamondPlate.bumpMap,
    bumpScale: 0.03,
    roughnessMap: textures.cleanDiamondPlate.roughnessMap,
    roughness: 0.62,
    metalness: 0.72,
  })

  const claddingMat = new THREE.MeshStandardMaterial({
    color: 0xb7c2cf,
    map: textures.cleanSteel.map,
    bumpMap: textures.cleanSteel.bumpMap,
    bumpScale: 0.024,
    roughnessMap: textures.cleanSteel.roughnessMap,
    roughness: 0.54,
    metalness: 0.68,
  })

  const frameSteelMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.steelMid,
    roughness: 0.52,
    metalness: 0.74,
  })

  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.steelDark,
    roughness: 0.68,
    metalness: 0.58,
  })

  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.cleanHazard,
    roughness: 0.55,
    metalness: 0.25,
  })

  const doorSteelMat = new THREE.MeshStandardMaterial({
    color: 0x8f9dad,
    map: textures.cleanSteel.map,
    bumpMap: textures.cleanSteel.bumpMap,
    bumpScale: 0.022,
    roughness: 0.48,
    metalness: 0.78,
  })

  const doorWindowMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.glassTint,
    roughness: 0.16,
    metalness: 0.3,
    transparent: true,
    opacity: 0.74,
  })

  const cableMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.cableSteel,
    roughness: 0.58,
    metalness: 0.75,
  })

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

  const statusMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_PALETTE.exitUnlockedGlow,
    emissive: ELEVATOR_PALETTE.exitUnlockedAccent,
    emissiveIntensity: 1.05,
    roughness: 0.25,
    metalness: 0.28,
    transparent: true,
    opacity: 0.72,
  })

  // 1. Industrial metal elevator platform + threshold chevron strip + hydraulic pit buffers
  const subChassis = makeMesh(
    new THREE.BoxGeometry(2.96, 0.026, 2.96),
    darkTrimMat,
    'extraction-elevator-subchassis'
  )
  subChassis.position.y = 0.013
  group.add(subChassis)

  const platformDeck = makeMesh(
    new THREE.BoxGeometry(2.88, 0.036, 2.88),
    deckMat,
    'extraction-elevator-platform'
  )
  platformDeck.position.y = ELEVATOR_DECK_TOP_Y - 0.018
  group.add(platformDeck)

  const thresholdSill = makeMesh(
    new THREE.BoxGeometry(2.58, 0.022, 0.16),
    hazardMat,
    'extraction-elevator-threshold-sill'
  )
  thresholdSill.position.set(0, ELEVATOR_DECK_TOP_Y - 0.009, -1.46)
  group.add(thresholdSill)

  // Glowing threshold status guide strip embedded cleanly into doorway sill
  const thresholdGlowStrip = makeMesh(
    new THREE.BoxGeometry(2.26, 0.012, 0.055),
    frameMat,
    'extraction-elevator-sill-strip'
  )
  thresholdGlowStrip.position.set(0, ELEVATOR_DECK_TOP_Y + 0.002, -1.36)
  group.add(thresholdGlowStrip)

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

  // Hydraulic bottom shock buffers flanking front corners
  for (let s = -1; s <= 1; s += 2) {
    const bufferCyl = makeMesh(
      new THREE.CylinderGeometry(0.06, 0.07, 0.18, 10),
      darkTrimMat,
      `extraction-elevator-buffer-${s < 0 ? 'left' : 'right'}`
    )
    bufferCyl.position.set(s * 1.46, 0.09, 1.44)
    group.add(bufferCyl)
  }

  // 2. Heavy structural steel frame (4 H-columns + portal header transom + hoist winch assembly)
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

  // Heavy front portal lintel & header transom
  const headerTransom = makeMesh(
    new THREE.BoxGeometry(3.54, 0.24, 0.36),
    darkTrimMat,
    'extraction-elevator-header',
    { castShadow: true }
  )
  headerTransom.position.set(0, 2.52, -1.56)
  group.add(headerTransom)

  // Glowing horizontal signage band across elevator portal header
  const headerSignBar = makeMesh(
    new THREE.BoxGeometry(1.86, 0.09, 0.38),
    frameMat,
    'extraction-elevator-header-sign'
  )
  headerSignBar.position.set(0, 2.52, -1.56)
  group.add(headerSignBar)

  // Overhead extraction frame beams + roof deck + twin hoist winch sheaves
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

  const cabinCeiling = makeMesh(
    new THREE.BoxGeometry(3.06, 0.07, 3.06),
    darkTrimMat,
    'extraction-elevator-ceiling-deck'
  )
  cabinCeiling.position.set(0, 2.52, 0)
  group.add(cabinCeiling)

  // Recessed interior emergency overhead dome light strip
  const interiorLightStrip = makeMesh(
    new THREE.BoxGeometry(1.76, 0.035, 0.42),
    beaconMat,
    'extraction-elevator-cabin-light'
  )
  interiorLightStrip.position.set(0, 2.47, 0.12)
  group.add(interiorLightStrip)

  // Overhead winch assembly + dual grooved sheaves (top <= 2.71m, safely below 3.04m maze beams)
  const winchCrossbar = makeMesh(
    new THREE.BoxGeometry(1.12, 0.14, 0.26),
    frameSteelMat,
    'extraction-elevator-winch-mount'
  )
  winchCrossbar.position.set(0, 2.61, 0)
  group.add(winchCrossbar)

  for (let s = -1; s <= 1; s += 2) {
    const sheave = makeMesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.07, 14),
      darkTrimMat,
      `extraction-elevator-sheave-${s < 0 ? 'left' : 'right'}`
    )
    sheave.rotation.z = Math.PI / 2
    sheave.position.set(s * 0.34, 2.62, 0)
    group.add(sheave)
  }

  // 3. Wall-backed armored elevator cabin walls, safety grab rails & illuminated strips
  const addCabinWall = (sideName) => {
    const wallGroup = new THREE.Group()
    wallGroup.name = `extraction-elevator-cabin-wall-${sideName}`
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
      `extraction-elevator-wall-panel-${sideName}`,
      { castShadow: true }
    )
    panel.position.y = 1.24
    wallGroup.add(panel)

    // Vertical seam battens
    for (let b = -1; b <= 1; b += 2) {
      const batten = makeMesh(
        new THREE.BoxGeometry(0.07, 2.38, 0.1),
        darkTrimMat,
        `extraction-elevator-batten-${sideName}-${b < 0 ? 'a' : 'b'}`
      )
      batten.position.set(b * 0.94, 1.24, -0.02)
      wallGroup.add(batten)
    }

    // Stainless steel grab rail
    const rail = makeMesh(
      new THREE.CylinderGeometry(0.028, 0.028, 2.52, 8),
      frameSteelMat,
      `extraction-elevator-grab-rail-${sideName}`
    )
    rail.rotation.z = Math.PI / 2
    rail.position.set(0, 1.02, -0.1)
    wallGroup.add(rail)

    if (sideName === 'rear') {
      const rearArrowStrip = makeMesh(
        new THREE.BoxGeometry(1.36, 0.08, 0.03),
        frameMat,
        'extraction-elevator-rear-beacon-bar'
      )
      rearArrowStrip.position.set(0, 1.98, -0.05)
      wallGroup.add(rearArrowStrip)
    }

    group.add(wallGroup)
  }

  for (let i = 0; i < sideEntries.length; i += 1) {
    const [sideName, isOpen] = sideEntries[i]
    if (!isOpen) addCabinWall(sideName)
  }

  // 4. Heavy Telescoping Bi-Parting Sliding Doors (open into ±1.28..±1.38 pockets -> clear > 2.2m opening)
  const doorsGroup = new THREE.Group()
  doorsGroup.name = 'extraction-elevator-doors'

  const makeDoorLeaf = (name, zOffset, hasWindow = true) => {
    const leaf = new THREE.Group()
    leaf.name = name

    const slab = makeMesh(
      new THREE.BoxGeometry(0.68, 2.26, 0.06),
      doorSteelMat,
      `${name}-panel`,
      { castShadow: true }
    )
    slab.position.y = 1.19
    leaf.add(slab)

    // Reinforced bumper edge trim
    const rib = makeMesh(
      new THREE.BoxGeometry(0.66, 0.12, 0.075),
      darkTrimMat,
      `${name}-kickplate`
    )
    rib.position.y = 0.24
    leaf.add(rib)

    if (hasWindow) {
      const windowPane = makeMesh(
        new THREE.BoxGeometry(0.14, 0.58, 0.072),
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

  const leftInner = makeDoorLeaf('extraction-door-left-inner', -1.44, true)
  const rightInner = makeDoorLeaf('extraction-door-right-inner', -1.44, true)
  const leftOuter = makeDoorLeaf('extraction-door-left-outer', -1.51, false)
  const rightOuter = makeDoorLeaf('extraction-door-right-outer', -1.51, false)
  const doors = { leftInner, rightInner, leftOuter, rightOuter }

  // Electromagnetic security crossbar across closed center seam (hides once unlocked)
  const lockBarGroup = new THREE.Group()
  lockBarGroup.name = 'extraction-elevator-lock-bar'
  lockBarGroup.position.set(0, 1.24, -1.39)

  const lockBeam = makeMesh(
    new THREE.BoxGeometry(2.38, 0.11, 0.08),
    darkTrimMat,
    'extraction-lock-beam'
  )
  lockBarGroup.add(lockBeam)

  const lockSealCore = makeMesh(
    new THREE.BoxGeometry(0.42, 0.16, 0.11),
    statusMat,
    'extraction-lock-status-core'
  )
  lockBarGroup.add(lockSealCore)

  lockBarGroup.visible = false
  group.add(doorsGroup)
  group.add(lockBarGroup)

  // 5. Industrial Control Panel Console (pedestal beside entrance + keycard slot + LED screen + conduit)
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

  // Armored conduit rising from control console to portal header
  const consoleConduit = makeMesh(
    new THREE.CylinderGeometry(0.026, 0.026, 1.04, 8),
    cableMat,
    'extraction-control-conduit'
  )
  consoleConduit.position.set(0, 1.98, -0.02)
  controlPanel.add(consoleConduit)
  group.add(controlPanel)

  // 6. Dual Overhead Emergency Beacons & Hanging Power/Tension Cables
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

  // Vertical tension hoist cables & back-corner armored traveler power cable loop
  for (let i = 0; i < 2; i += 1) {
    const cx = i === 0 ? -0.34 : 0.34
    const tensionCable = makeMesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.24, 8),
      cableMat,
      `extraction-elevator-hoist-cable-${i}`
    )
    tensionCable.position.set(cx, 2.58, 0.04)
    group.add(tensionCable)
  }

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

  group.userData = {
    isExitGate: true,
    isExitElevator: true,
    isLocked: false,
    unlockProgress: 1,
    unlockFlashTimer: 0,
    frameMat,
    beaconMat,
    statusMat,
    portalMat: statusMat,
    doors,
    doorsGroup,
    lockBarGroup,
    controlPanel,
    beaconGlowGroup,
    localSides,
    yaw: layout.yaw,
    deckTopY: ELEVATOR_DECK_TOP_Y,
  }

  syncExtractionDoorPositions(group, 1)
  return group
}
