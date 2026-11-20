import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  WALL_HEIGHT,
  gridToWorld,
} from '../world/worldCoords.js'
import { isSharedResource } from './sharedResources.js'
import {
  applyFloorGeometrySurfaceDetails,
  buildSelectiveGraffitiMesh,
  getMazeSurfaceTextureSet,
} from './mazeSurfaceTextures.js'

const FLOOR_THICKNESS = 0.25
const WALL_CAP_HEIGHT = 0.14
const MARKER_BASE_HEIGHT = 0.06

export const MAZE_MESH_PALETTE = {
  floor: 0x1c283d, // Readable dark concrete facility floor
  wallBody: 0x2f405b, // Cool slate industrial concrete wall body
  wallBevel: 0x485f82, // Precast top coping bevel highlight
  markerBase: 0x111927,
  startAccent: 0x818cf8, // --color-start
  exitAccent: 0x10b981, // --color-exit
  exitGlow: 0x6ee7b7, // --color-exit-glow
  exitLocked: 0xef4444,
  exitLockedGlow: 0xf97316,
  gateSteel: 0x475569,
  gateSteelDark: 0x283548,
}

function createStartMarker(worldPos) {
  const group = new THREE.Group()
  group.name = 'maze-marker-start'
  group.position.set(worldPos.x, 0, worldPos.z)

  const baseGeo = new THREE.CylinderGeometry(
    CELL_SIZE * 0.34,
    CELL_SIZE * 0.38,
    MARKER_BASE_HEIGHT,
    24
  )
  const baseMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.markerBase,
    roughness: 0.85,
    metalness: 0.15,
  })
  const baseMesh = new THREE.Mesh(baseGeo, baseMat)
  baseMesh.position.y = MARKER_BASE_HEIGHT / 2
  group.add(baseMesh)

  const ringGeo = new THREE.TorusGeometry(CELL_SIZE * 0.24, 0.05, 10, 32)
  const ringMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.startAccent,
    emissive: MAZE_MESH_PALETTE.startAccent,
    emissiveIntensity: 0.5,
    roughness: 0.45,
    metalness: 0.2,
  })
  const ringMesh = new THREE.Mesh(ringGeo, ringMat)
  ringMesh.rotation.x = Math.PI / 2
  ringMesh.position.y = MARKER_BASE_HEIGHT + 0.03
  group.add(ringMesh)

  const coreGeo = new THREE.CylinderGeometry(
    CELL_SIZE * 0.1,
    CELL_SIZE * 0.1,
    0.04,
    16
  )
  const coreMesh = new THREE.Mesh(coreGeo, ringMat)
  coreMesh.position.y = MARKER_BASE_HEIGHT + 0.02
  group.add(coreMesh)

  return group
}

function resolveExitGateYaw(grid, exit) {
  if (!Array.isArray(grid) || !exit) return 0
  const { row, col } = exit
  const northOpen = grid[row - 1]?.[col] === CELL_TYPES.PATH
  const southOpen = grid[row + 1]?.[col] === CELL_TYPES.PATH
  const eastOpen = grid[row]?.[col + 1] === CELL_TYPES.PATH
  const westOpen = grid[row]?.[col - 1] === CELL_TYPES.PATH

  // Archway spans across X in local space, facing +-Z by default.
  // If approach is along East/West corridor, rotate 90deg so archway faces East/West.
  if ((eastOpen || westOpen) && !(northOpen || southOpen)) {
    return Math.PI / 2
  }
  return 0
}

function applyGateMaterialPalette(gateGroup, isLocked, intensityBoost = 0) {
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
    ? MAZE_MESH_PALETTE.exitLocked
    : MAZE_MESH_PALETTE.exitAccent
  const glowHex = isLocked
    ? MAZE_MESH_PALETTE.exitLockedGlow
    : MAZE_MESH_PALETTE.exitGlow

  if (ud.frameMat) {
    if (stateChanged) {
      ud.frameMat.color.setHex(accentHex)
      ud.frameMat.emissive.setHex(accentHex)
    }
    if (stateChanged || intensityChanged) {
      ud.frameMat.emissiveIntensity = 0.55 + intensityBoost
    }
  }
  if (ud.diamondMat) {
    if (stateChanged) {
      ud.diamondMat.color.setHex(glowHex)
      ud.diamondMat.emissive.setHex(glowHex)
    }
    if (stateChanged || intensityChanged) {
      ud.diamondMat.emissiveIntensity = 0.72 + intensityBoost
    }
  }
  if (ud.beaconMat) {
    if (stateChanged) {
      ud.beaconMat.color.setHex(glowHex)
      ud.beaconMat.emissive.setHex(accentHex)
    }
    if (stateChanged || intensityChanged) {
      ud.beaconMat.emissiveIntensity = (isLocked ? 0.85 : 1.05) + intensityBoost
    }
  }
  if (ud.portalMat) {
    if (stateChanged) {
      ud.portalMat.color.setHex(glowHex)
      ud.portalMat.emissive.setHex(accentHex)
      ud.portalMat.opacity = isLocked ? 0.14 : 0.78
    }
    if (stateChanged || intensityChanged) {
      ud.portalMat.emissiveIntensity = (isLocked ? 0.25 : 0.95) + intensityBoost
    }
  }

  ud._appliedLocked = isLocked
  ud._lastIntensityBoost = intensityBoost
}

export function setExitGateState(gateGroup, isLocked, options = {}) {
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
    const p = ud.unlockProgress
    if (ud.barrierGroup) {
      ud.barrierGroup.visible = nextLocked
      ud.barrierGroup.scale.set(1, Math.max(0.01, 1 - p), 1)
      ud.barrierGroup.position.y = p * 1.15
    }
    if (ud.lockSigil) {
      ud.lockSigil.visible = nextLocked
      ud.lockSigil.scale.setScalar(Math.max(0.01, 1 - p))
    }
    ud._lastProgress = p
  }

  if (ud.barrierGroup) {
    ud.barrierGroup.visible = nextLocked || ud.unlockProgress < 1
  }
  if (ud.portalRing) {
    ud.portalRing.visible = !nextLocked
  }

  applyGateMaterialPalette(gateGroup, nextLocked, ud.unlockFlashTimer > 0 ? 0.7 : 0)
  return true
}

export function updateExitGate(gateGroup, delta = 0.016, elapsedSec = 0) {
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
  const isTransitioning = p > 0 && p < 1
  const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * (ud.isLocked ? 3.2 : 2.1))

  if (ud.barrierGroup) {
    const showBarrier = ud.isLocked || p < 0.98
    if (ud.barrierGroup.visible !== showBarrier) {
      ud.barrierGroup.visible = showBarrier
    }
    if (showBarrier && progressChanged) {
      const barrierScale = Math.max(0.01, 1 - p)
      ud.barrierGroup.scale.set(1, barrierScale, 1)
      ud.barrierGroup.position.y = p * 1.15
    }
  }

  if (ud.lockSigil) {
    const showSigil = ud.isLocked || p < 0.95
    if (ud.lockSigil.visible !== showSigil) {
      ud.lockSigil.visible = showSigil
    }
    if (showSigil) {
      ud.lockSigil.rotation.y += delta * (ud.isLocked ? 1.6 : 5.2)
      if (progressChanged) {
        ud.lockSigil.scale.setScalar(Math.max(0.01, 1 - p))
      }
    }
  }

  const barrierActive = Boolean(ud.barrierGroup?.visible) || isTransitioning
  if (barrierActive) {
    if (ud.barrierFieldMat) {
      const nextFieldOpacity = (0.22 + pulse * 0.14) * (1 - p)
      if (
        typeof ud._lastFieldOpacity !== 'number' ||
        Math.abs(ud._lastFieldOpacity - nextFieldOpacity) > 0.004
      ) {
        ud.barrierFieldMat.opacity = nextFieldOpacity
        ud._lastFieldOpacity = nextFieldOpacity
      }
    }
    if (ud.barrierBarMat) {
      const nextBarOpacity = (0.85 + pulse * 0.15) * (1 - p)
      const nextBarEmissive = 0.75 + pulse * 0.35
      if (
        typeof ud._lastBarOpacity !== 'number' ||
        Math.abs(ud._lastBarOpacity - nextBarOpacity) > 0.004
      ) {
        ud.barrierBarMat.opacity = nextBarOpacity
        ud._lastBarOpacity = nextBarOpacity
      }
      if (
        typeof ud._lastBarEmissive !== 'number' ||
        Math.abs(ud._lastBarEmissive - nextBarEmissive) > 0.004
      ) {
        ud.barrierBarMat.emissiveIntensity = nextBarEmissive
        ud._lastBarEmissive = nextBarEmissive
      }
    }
  }

  if (ud.portalRing) {
    const showPortal = !ud.isLocked || p > 0.15
    if (ud.portalRing.visible !== showPortal) {
      ud.portalRing.visible = showPortal
    }
    if (showPortal) {
      ud.portalRing.rotation.z += delta * 1.15
      const flashBoost = ud.unlockFlashTimer > 0 ? (ud.unlockFlashTimer / 0.85) * 0.35 : 0
      ud.portalRing.scale.setScalar(0.95 + pulse * 0.06 + flashBoost)
    }
  }

  ud._lastProgress = p

  const flashIntensity =
    ud.unlockFlashTimer > 0
      ? (ud.unlockFlashTimer / 0.85) * 1.15
      : Number((pulse * 0.18).toFixed(3))
  applyGateMaterialPalette(gateGroup, ud.isLocked, flashIntensity)
}

function createExitMarker(worldPos, maze = null) {
  const group = new THREE.Group()
  group.name = 'maze-marker-exit'
  group.position.set(worldPos.x, 0, worldPos.z)
  group.rotation.y = resolveExitGateYaw(maze?.grid, maze?.exit)

  // 1. Floor threshold base pad
  const baseGeo = new THREE.BoxGeometry(
    CELL_SIZE * 0.78,
    MARKER_BASE_HEIGHT,
    CELL_SIZE * 0.78
  )
  const baseMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.markerBase,
    roughness: 0.8,
    metalness: 0.22,
  })
  const baseMesh = new THREE.Mesh(baseGeo, baseMat)
  baseMesh.position.y = MARKER_BASE_HEIGHT / 2
  baseMesh.name = 'exit-base-pad'
  group.add(baseMesh)

  const frameGeo = new THREE.BoxGeometry(
    CELL_SIZE * 0.62,
    0.05,
    CELL_SIZE * 0.62
  )
  const frameMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.exitAccent,
    emissive: MAZE_MESH_PALETTE.exitAccent,
    emissiveIntensity: 0.55,
    roughness: 0.4,
    metalness: 0.2,
  })
  const frameMesh = new THREE.Mesh(frameGeo, frameMat)
  frameMesh.position.y = MARKER_BASE_HEIGHT + 0.025
  frameMesh.name = 'exit-floor-frame'
  group.add(frameMesh)

  const diamondGeo = new THREE.BoxGeometry(
    CELL_SIZE * 0.3,
    0.07,
    CELL_SIZE * 0.3
  )
  const diamondMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.exitGlow,
    emissive: MAZE_MESH_PALETTE.exitGlow,
    emissiveIntensity: 0.7,
    roughness: 0.3,
    metalness: 0.15,
  })
  const diamondMesh = new THREE.Mesh(diamondGeo, diamondMat)
  diamondMesh.rotation.y = Math.PI / 4
  diamondMesh.position.y = MARKER_BASE_HEIGHT + 0.06
  diamondMesh.name = 'exit-floor-diamond'
  group.add(diamondMesh)

  // 2. Heavy Left & Right Gate Pylons + Top Arch Lintel
  const steelMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.gateSteel,
    roughness: 0.48,
    metalness: 0.72,
  })
  const darkSteelMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.gateSteelDark,
    roughness: 0.65,
    metalness: 0.55,
  })
  const beaconMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.exitGlow,
    emissive: MAZE_MESH_PALETTE.exitAccent,
    emissiveIntensity: 0.9,
    roughness: 0.25,
    metalness: 0.3,
  })

  const pylonSpan = CELL_SIZE * 0.38
  const pylonHeight = 2.65
  const pylonGeo = new THREE.BoxGeometry(0.28, pylonHeight, 0.34)
  const capGeo = new THREE.BoxGeometry(0.34, 0.18, 0.4)
  const coilGeo = new THREE.BoxGeometry(0.32, 0.14, 0.38)

  const sideSign = [-1, 1]
  for (let i = 0; i < sideSign.length; i += 1) {
    const sx = sideSign[i] * pylonSpan
    const pylon = new THREE.Mesh(pylonGeo, steelMat)
    pylon.position.set(sx, pylonHeight / 2, 0)
    pylon.name = `exit-gate-pylon-${i}`
    pylon.castShadow = true
    pylon.receiveShadow = true
    group.add(pylon)

    const plinth = new THREE.Mesh(capGeo, darkSteelMat)
    plinth.position.set(sx, 0.09, 0)
    plinth.receiveShadow = true
    group.add(plinth)

    const beaconCoil = new THREE.Mesh(coilGeo, beaconMat)
    beaconCoil.position.set(sx, 1.55, 0)
    beaconCoil.name = `exit-gate-beacon-${i}`
    group.add(beaconCoil)
  }

  const lintelGeo = new THREE.BoxGeometry(pylonSpan * 2 + 0.42, 0.28, 0.38)
  const lintel = new THREE.Mesh(lintelGeo, darkSteelMat)
  lintel.position.set(0, pylonHeight + 0.12, 0)
  lintel.name = 'exit-gate-lintel'
  lintel.castShadow = true
  lintel.receiveShadow = true
  group.add(lintel)

  const headerBeaconGeo = new THREE.BoxGeometry(0.7, 0.12, 0.42)
  const headerBeacon = new THREE.Mesh(headerBeaconGeo, beaconMat)
  headerBeacon.position.set(0, pylonHeight + 0.14, 0)
  headerBeacon.name = 'exit-gate-header-beacon'
  group.add(headerBeacon)

  // 3. Locked Barrier Assembly (energy containment field + horizontal laser bars + lock sigil)
  const barrierGroup = new THREE.Group()
  barrierGroup.name = 'exit-gate-barrier'

  const barrierBarMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.exitLockedGlow,
    emissive: MAZE_MESH_PALETTE.exitLocked,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.25,
    transparent: true,
    opacity: 0.92,
  })
  const barGeo = new THREE.CylinderGeometry(0.036, 0.036, pylonSpan * 2 - 0.18, 10)
  const barHeights = [0.7, 1.35, 2.0]
  for (let i = 0; i < barHeights.length; i += 1) {
    const bar = new THREE.Mesh(barGeo, barrierBarMat)
    bar.rotation.z = Math.PI / 2
    bar.position.y = barHeights[i]
    bar.name = `exit-barrier-bar-${i}`
    barrierGroup.add(bar)
  }

  const fieldGeo = new THREE.BoxGeometry(pylonSpan * 2 - 0.24, pylonHeight - 0.35, 0.05)
  const barrierFieldMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.exitLocked,
    emissive: MAZE_MESH_PALETTE.exitLocked,
    emissiveIntensity: 0.65,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  })
  const fieldMesh = new THREE.Mesh(fieldGeo, barrierFieldMat)
  fieldMesh.position.y = 1.35
  fieldMesh.name = 'exit-barrier-field'
  barrierGroup.add(fieldMesh)

  const sigilGeo = new THREE.OctahedronGeometry(0.24, 0)
  const lockSigil = new THREE.Mesh(sigilGeo, barrierBarMat)
  lockSigil.position.y = 1.35
  lockSigil.name = 'exit-barrier-sigil'
  barrierGroup.add(lockSigil)

  barrierGroup.visible = false
  group.add(barrierGroup)

  // 4. Unlocked Portal Ring
  const portalGeo = new THREE.TorusGeometry(0.78, 0.055, 10, 32)
  const portalMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.exitGlow,
    emissive: MAZE_MESH_PALETTE.exitAccent,
    emissiveIntensity: 0.95,
    roughness: 0.18,
    metalness: 0.4,
    transparent: true,
    opacity: 0.78,
  })
  const portalRing = new THREE.Mesh(portalGeo, portalMat)
  portalRing.position.set(0, 1.38, 0)
  portalRing.name = 'exit-portal-ring'
  group.add(portalRing)

  group.userData = {
    isExitGate: true,
    isLocked: false,
    unlockProgress: 1,
    unlockFlashTimer: 0,
    frameMat,
    diamondMat,
    beaconMat,
    barrierGroup,
    barrierBarMat,
    barrierFieldMat,
    lockSigil,
    portalRing,
    portalMat,
  }

  return group
}

/**
 * Converts a canonical `maze` (`maze.grid`) into a Three.js Group containing:
 *  - Continuous stone floor slab
 *  - Instanced 3D walls + stone bevel top caps (2 draw calls total)
 *  - Distinct entrance (start) and exit floor markers
 *
 * Returns null if `maze` or `maze.grid` is missing/malformed.
 */
export function buildMazeMeshes(maze) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return null
  }

  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) {
    return null
  }

  const topLeft = gridToWorld(0, 0, maze)
  const bottomRight = gridToWorld(rows - 1, cols - 1, maze)
  if (!topLeft || !bottomRight) {
    return null
  }

  const root = new THREE.Group()
  root.name = 'maze-geometry-root'

  const surfaceSet = getMazeSurfaceTextureSet()

  // 1. Continuous textured concrete floor spanning the entire grid footprint
  const floorWidth = cols * CELL_SIZE
  const floorDepth = rows * CELL_SIZE
  const floorCenterX = (topLeft.x + bottomRight.x) / 2
  const floorCenterZ = (topLeft.z + bottomRight.z) / 2

  const floorGeo = new THREE.BoxGeometry(
    floorWidth,
    FLOOR_THICKNESS,
    floorDepth,
    cols * 2,
    1,
    rows * 2
  )
  applyFloorGeometrySurfaceDetails(floorGeo, maze, floorWidth, floorDepth)

  const floorMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.floor,
    map: surfaceSet.floor.map,
    roughnessMap: surfaceSet.floor.roughnessMap,
    bumpMap: surfaceSet.floor.bumpMap,
    bumpScale: 0.032,
    roughness: 0.94,
    metalness: 0.06,
    vertexColors: true,
  })
  const floorMesh = new THREE.Mesh(floorGeo, floorMat)
  floorMesh.name = 'maze-floor'
  floorMesh.position.set(floorCenterX, -FLOOR_THICKNESS / 2, floorCenterZ)
  floorMesh.receiveShadow = true
  root.add(floorMesh)

  // 2. Collect wall cell positions from canonical maze.grid
  const wallPositions = []
  const wallCells = []
  let pathCount = 0

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] === CELL_TYPES.WALL) {
        const worldPos = gridToWorld(r, c, maze)
        if (worldPos) {
          wallPositions.push(worldPos)
          wallCells.push({ r, c, worldPos })
        }
      } else {
        pathCount += 1
      }
    }
  }

  // 3. Instanced weathered concrete walls & precast coping top caps
  let wallMat = null
  let capMat = null
  let graffitiMesh = null
  if (wallPositions.length > 0) {
    const bodyHeight = Math.max(0.5, WALL_HEIGHT - WALL_CAP_HEIGHT)
    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, bodyHeight, CELL_SIZE)
    wallMat = new THREE.MeshStandardMaterial({
      color: MAZE_MESH_PALETTE.wallBody,
      map: surfaceSet.wall.map,
      roughnessMap: surfaceSet.wall.roughnessMap,
      bumpMap: surfaceSet.wall.bumpMap,
      bumpScale: 0.04,
      roughness: 0.88,
      metalness: 0.1,
    })

    const wallInstanced = new THREE.InstancedMesh(
      wallGeo,
      wallMat,
      wallPositions.length
    )
    wallInstanced.name = 'maze-walls'
    wallInstanced.castShadow = true
    wallInstanced.receiveShadow = true

    const capGeo = new THREE.BoxGeometry(
      CELL_SIZE * 0.94,
      WALL_CAP_HEIGHT,
      CELL_SIZE * 0.94
    )
    capMat = new THREE.MeshStandardMaterial({
      color: MAZE_MESH_PALETTE.wallBevel,
      map: surfaceSet.cap.map,
      bumpMap: surfaceSet.cap.bumpMap,
      bumpScale: 0.025,
      roughness: 0.72,
      metalness: 0.14,
    })

    const capInstanced = new THREE.InstancedMesh(
      capGeo,
      capMat,
      wallPositions.length
    )
    capInstanced.name = 'maze-wall-caps'
    capInstanced.castShadow = true
    capInstanced.receiveShadow = true

    const dummy = new THREE.Object3D()
    const instanceTint = new THREE.Color()
    const bodyCenterY = bodyHeight / 2
    const capCenterY = bodyHeight + WALL_CAP_HEIGHT / 2

    for (let i = 0; i < wallCells.length; i += 1) {
      const { r, c, worldPos } = wallCells[i]
      const { x, z } = worldPos

      // Deterministic subtle per-column weathered concrete shade & dampness jitter
      const hashA = (((r * 73856093) ^ (c * 19349663)) >>> 0) / 4294967295
      const hashB = (((r * 83492791) ^ (c * 2971215073)) >>> 0) / 4294967295
      const wallTone = 0.89 + hashA * 0.16
      const chromaShift = (hashB - 0.5) * 0.045
      instanceTint.setRGB(
        wallTone + chromaShift,
        wallTone + (hashB > 0.65 ? 0.012 : 0),
        wallTone - chromaShift * 0.6,
        THREE.SRGBColorSpace
      )

      dummy.position.set(x, bodyCenterY, z)
      dummy.updateMatrix()
      wallInstanced.setMatrixAt(i, dummy.matrix)
      wallInstanced.setColorAt(i, instanceTint)

      const capTone = 0.9 + hashA * 0.14
      instanceTint.setRGB(capTone, capTone, capTone, THREE.SRGBColorSpace)
      dummy.position.set(x, capCenterY, z)
      dummy.updateMatrix()
      capInstanced.setMatrixAt(i, dummy.matrix)
      capInstanced.setColorAt(i, instanceTint)
    }

    wallInstanced.instanceMatrix.needsUpdate = true
    if (wallInstanced.instanceColor) {
      wallInstanced.instanceColor.needsUpdate = true
    }
    wallInstanced.computeBoundingBox()
    wallInstanced.computeBoundingSphere()

    capInstanced.instanceMatrix.needsUpdate = true
    if (capInstanced.instanceColor) {
      capInstanced.instanceColor.needsUpdate = true
    }
    capInstanced.computeBoundingBox()
    capInstanced.computeBoundingSphere()

    root.add(wallInstanced)
    root.add(capInstanced)

    // Selective, restrained facility graffiti merged into 1 static decal mesh
    graffitiMesh = buildSelectiveGraffitiMesh(
      maze,
      surfaceSet.graffitiMaterial,
      bodyHeight
    )
    if (graffitiMesh) {
      root.add(graffitiMesh)
    }
  }

  // 4. Entrance & Exit floor markers anchored via gridToWorld()
  if (maze.start) {
    const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)
    if (startWorld) {
      root.add(createStartMarker(startWorld))
    }
  }

  let exitGate = null
  if (maze.exit) {
    const exitWorld = gridToWorld(maze.exit.row, maze.exit.col, maze)
    if (exitWorld) {
      exitGate = createExitMarker(exitWorld, maze)
      root.add(exitGate)
    }
  }

  root.userData = {
    mazeId: maze.id || null,
    rows,
    cols,
    wallCount: wallPositions.length,
    pathCount,
    floorWidth,
    floorDepth,
    exitGate,
    wallPositions,
    floorMat,
    wallMat,
    capMat,
    graffitiMesh,
    graffitiCount: graffitiMesh?.userData?.decalCount || 0,
  }

  return root
}

/**
 * Safely disposes all geometries, materials, and child objects owned by a
 * maze geometry group and detaches it from its parent scene if attached.
 */
export function disposeMazeGroup(group) {
  if (!group) return false

  const disposedGeometries = new Set()
  const disposedMaterials = new Set()

  group.traverse((node) => {
    if (
      node.geometry &&
      !isSharedResource(node.geometry) &&
      !disposedGeometries.has(node.geometry)
    ) {
      disposedGeometries.add(node.geometry)
      if (typeof node.geometry.dispose === 'function') {
        node.geometry.dispose()
      }
    }

    if (node.material) {
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material]
      for (let i = 0; i < materials.length; i += 1) {
        const mat = materials[i]
        if (mat && !isSharedResource(mat) && !disposedMaterials.has(mat)) {
          disposedMaterials.add(mat)
          if (typeof mat.dispose === 'function') {
            mat.dispose()
          }
        }
      }
    }

    if (typeof node.dispose === 'function' && node !== group) {
      node.dispose()
    }
  })

  if (group.parent) {
    group.parent.remove(group)
  }
  group.clear()

  return true
}
