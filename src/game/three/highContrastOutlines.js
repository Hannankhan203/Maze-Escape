import * as THREE from 'three'
import { POWERUP_TYPES } from '../mechanics/powerups.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { HIDING_SPOT_TYPES } from '../generation/hidingSpotPlacement.js'
import { CELL_SIZE, WALL_HEIGHT } from '../world/worldCoords.js'
import { MAZE_MESH_PALETTE } from './buildMazeMeshes.js'
import {
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

export const HIGH_CONTRAST_COLORS = {
  wallEdge: 0x7dd3fc,
  wallBody: 0x2d3f59,
  wallBevel: 0x64748b,
  startMarker: 0xa5b4fc,
  exitUnlocked: 0x34d399,
  exitLocked: 0xfb7185,
  coin: 0xfef08a,
  keycard: 0x67e8f9,
  echoMarker: 0x7dd3fc,
  wallPass: 0xa5b4fc,
  echoReveal: 0x7dd3fc,
  coinMagnet: 0x6ee7b7,
  hidingSpot: 0x38bdf8,
  hazardSpikes: 0xf87171,
  hazardPlate: 0xfbbf24,
  hazardElectric: 0xf87171,
  enemy: 0xff3b5c,
}

const outlineGeoPool = new Map()
const outlineMatPool = new Map()

function getPooledOutlineGeometry(key, factory) {
  let geo = outlineGeoPool.get(key)
  if (!geo) {
    geo = markSharedResource(factory())
    outlineGeoPool.set(key, geo)
  }
  return geo
}

function getPooledOutlineMaterial(key, colorHex) {
  let mat = outlineMatPool.get(key)
  if (!mat) {
    mat = markSharedResource(
      new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.94,
        fog: false,
      })
    )
    outlineMatPool.set(key, mat)
  }
  return mat
}

export function disposeHighContrastPools() {
  for (const geo of outlineGeoPool.values()) {
    geo?.dispose?.()
  }
  outlineGeoPool.clear()

  for (const mat of outlineMatPool.values()) {
    mat?.dispose?.()
  }
  outlineMatPool.clear()
}

export function getHighContrastPoolStats() {
  return {
    geometries: outlineGeoPool.size,
    materials: outlineMatPool.size,
  }
}

registerSharedPoolClearer(disposeHighContrastPools)

function getUnitBoxEdges() {
  return getPooledOutlineGeometry('unit:box', () => {
    const box = new THREE.BoxGeometry(1, 1, 1)
    const edges = new THREE.EdgesGeometry(box)
    box.dispose()
    return edges
  })
}

function getUnitRingOutlineGeometry() {
  return getPooledOutlineGeometry('unit:ring', () => {
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 16)
    const edges = new THREE.EdgesGeometry(cyl, 20)
    cyl.dispose()
    return edges
  })
}

function createScaledOutlineBox({
  name,
  matKey,
  color,
  width,
  height,
  depth,
  x = 0,
  y = 0,
  z = 0,
}) {
  const line = new THREE.LineSegments(
    getUnitBoxEdges(),
    getPooledOutlineMaterial(matKey, color)
  )
  line.name = name
  line.scale.set(width, height, depth)
  line.position.set(x, y, z)
  line.userData = { isHighContrastOutline: true }
  return line
}

function createScaledOutlineRing({
  name,
  matKey,
  color,
  radius,
  height,
  x = 0,
  y = 0,
  z = 0,
  rotX = 0,
}) {
  const line = new THREE.LineSegments(
    getUnitRingOutlineGeometry(),
    getPooledOutlineMaterial(matKey, color)
  )
  line.name = name
  line.scale.set(radius, height, radius)
  line.position.set(x, y, z)
  line.rotation.x = rotX
  line.userData = { isHighContrastOutline: true }
  return line
}

/**
 * Builds a single merged LineSegments geometry enclosing every maze wall column
 * so high-contrast wall outlines cost at most 1 extra draw call.
 */
function ensureMazeWallOutline(mazeGroup) {
  if (!mazeGroup?.userData) return null
  if (mazeGroup.userData.wallOutline) {
    return mazeGroup.userData.wallOutline
  }

  const wallPositions = mazeGroup.userData.wallPositions
  if (!Array.isArray(wallPositions) || wallPositions.length === 0) {
    return null
  }

  const halfW = (CELL_SIZE * 1.004) / 2
  const halfD = (CELL_SIZE * 1.004) / 2
  const y0 = 0.01
  const y1 = WALL_HEIGHT + 0.012

  // 12 edges per wall cell (4 bottom, 4 top, 4 vertical corners) -> 24 vertices * 3 floats
  const floatsPerWall = 24 * 3
  const positions = new Float32Array(wallPositions.length * floatsPerWall)
  let offset = 0

  const pushSeg = (ax, ay, az, bx, by, bz) => {
    positions[offset] = ax
    positions[offset + 1] = ay
    positions[offset + 2] = az
    positions[offset + 3] = bx
    positions[offset + 4] = by
    positions[offset + 5] = bz
    offset += 6
  }

  for (let i = 0; i < wallPositions.length; i += 1) {
    const cx = wallPositions[i].x
    const cz = wallPositions[i].z
    const x0 = cx - halfW
    const x1 = cx + halfW
    const z0 = cz - halfD
    const z1 = cz + halfD

    // Top rectangle
    pushSeg(x0, y1, z0, x1, y1, z0)
    pushSeg(x1, y1, z0, x1, y1, z1)
    pushSeg(x1, y1, z1, x0, y1, z1)
    pushSeg(x0, y1, z1, x0, y1, z0)

    // Bottom rectangle
    pushSeg(x0, y0, z0, x1, y0, z0)
    pushSeg(x1, y0, z0, x1, y0, z1)
    pushSeg(x1, y0, z1, x0, y0, z1)
    pushSeg(x0, y0, z1, x0, y0, z0)

    // Vertical corners
    pushSeg(x0, y0, z0, x0, y1, z0)
    pushSeg(x1, y0, z0, x1, y1, z0)
    pushSeg(x1, y0, z1, x1, y1, z1)
    pushSeg(x0, y0, z1, x0, y1, z1)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = getPooledOutlineMaterial('wall:edge', HIGH_CONTRAST_COLORS.wallEdge)
  const line = new THREE.LineSegments(geometry, material)
  line.name = 'maze-walls-outline'
  line.userData = { isHighContrastOutline: true }
  mazeGroup.add(line)
  mazeGroup.userData.wallOutline = line
  return line
}

function syncMazeGroupContrast(mazeGroup, enabled) {
  if (!mazeGroup?.userData) return

  const { wallMat, capMat } = mazeGroup.userData
  if (wallMat?.color) {
    wallMat.color.setHex(enabled ? HIGH_CONTRAST_COLORS.wallBody : MAZE_MESH_PALETTE.wallBody)
  }
  if (capMat?.color) {
    capMat.color.setHex(enabled ? HIGH_CONTRAST_COLORS.wallBevel : MAZE_MESH_PALETTE.wallBevel)
  }

  if (enabled) {
    const wallOutline = ensureMazeWallOutline(mazeGroup)
    if (wallOutline) wallOutline.visible = true
  } else if (mazeGroup.userData.wallOutline) {
    mazeGroup.userData.wallOutline.visible = false
  }

  // Start elevator outline
  const startMarker = mazeGroup.getObjectByName?.('maze-marker-start')
  if (startMarker) {
    let outline = startMarker.userData?.highContrastOutline
    if (enabled && !outline) {
      const group = new THREE.Group()
      group.name = 'high-contrast-outline'
      group.add(
        createScaledOutlineBox({
          name: 'start-outline-platform',
          matKey: 'marker:start',
          color: HIGH_CONTRAST_COLORS.startMarker,
          width: 3.12,
          height: 0.14,
          depth: 3.12,
          y: 0.07,
        }),
        createScaledOutlineBox({
          name: 'start-outline-frame',
          matKey: 'marker:start',
          color: HIGH_CONTRAST_COLORS.startMarker,
          width: 3.52,
          height: 2.66,
          depth: 3.52,
          y: 1.33,
        })
      )
      group.userData = { isHighContrastOutline: true }
      startMarker.add(group)
      startMarker.userData = { ...(startMarker.userData || {}), highContrastOutline: group }
      outline = group
    }
    if (outline) outline.visible = Boolean(enabled)

    const startCabin = startMarker.userData?.cabinGroup
    if (startCabin) {
      let cabOutline = startCabin.userData?.highContrastOutline
      if (enabled && !cabOutline) {
        cabOutline = createScaledOutlineBox({
          name: 'start-cabin-outline',
          matKey: 'marker:start',
          color: HIGH_CONTRAST_COLORS.startMarker,
          width: 2.66,
          height: 2.54,
          depth: 2.66,
          y: 1.31,
        })
        startCabin.add(cabOutline)
        startCabin.userData = {
          ...(startCabin.userData || {}),
          highContrastOutline: cabOutline,
        }
      }
      if (cabOutline) cabOutline.visible = Boolean(enabled)
    }
  }

  // Exit extraction elevator outline
  const exitGate = mazeGroup.userData.exitGate
  if (exitGate) {
    let outline = exitGate.userData?.highContrastOutline
    const isLocked = Boolean(exitGate.userData?.isLocked)
    if (enabled && !outline) {
      const group = new THREE.Group()
      group.name = 'high-contrast-outline'
      const matKey = isLocked ? 'marker:exit:locked' : 'marker:exit:unlocked'
      const color = isLocked
        ? HIGH_CONTRAST_COLORS.exitLocked
        : HIGH_CONTRAST_COLORS.exitUnlocked
      group.add(
        createScaledOutlineBox({
          name: 'exit-outline-base',
          matKey,
          color,
          width: 3.12,
          height: 0.14,
          depth: 3.12,
          y: 0.07,
        }),
        createScaledOutlineBox({
          name: 'exit-outline-left-pylon',
          matKey,
          color,
          width: 0.34,
          height: 2.64,
          depth: 0.38,
          x: -1.66,
          y: 1.32,
          z: -1.66,
        }),
        createScaledOutlineBox({
          name: 'exit-outline-right-pylon',
          matKey,
          color,
          width: 0.34,
          height: 2.64,
          depth: 0.38,
          x: 1.66,
          y: 1.32,
          z: -1.66,
        }),
        createScaledOutlineBox({
          name: 'exit-outline-lintel',
          matKey,
          color,
          width: 3.58,
          height: 0.3,
          depth: 0.42,
          y: 2.54,
          z: -1.56,
        })
      )
      group.userData = { isHighContrastOutline: true }
      exitGate.add(group)
      exitGate.userData.highContrastOutline = group
      outline = group
    }
    if (outline) {
      outline.visible = Boolean(enabled)
      if (enabled) {
        syncExitGateOutlineColor(exitGate, isLocked, mazeGroup.userData.elevatorShaftsGroup)
      }
    }

    const exitCabin = exitGate.userData?.cabinGroup
    if (exitCabin) {
      let cabOutline = exitCabin.userData?.highContrastOutline
      if (enabled && !cabOutline) {
        const matKey = isLocked ? 'marker:exit:locked' : 'marker:exit:unlocked'
        const color = isLocked
          ? HIGH_CONTRAST_COLORS.exitLocked
          : HIGH_CONTRAST_COLORS.exitUnlocked
        cabOutline = createScaledOutlineBox({
          name: 'exit-cabin-outline',
          matKey,
          color,
          width: 2.68,
          height: 2.56,
          depth: 2.68,
          y: 1.32,
        })
        exitCabin.add(cabOutline)
        exitCabin.userData = {
          ...(exitCabin.userData || {}),
          highContrastOutline: cabOutline,
        }
      }
      if (cabOutline) {
        cabOutline.visible = Boolean(enabled)
        if (enabled) {
          syncExitGateOutlineColor(exitGate, isLocked, mazeGroup.userData.elevatorShaftsGroup)
        }
      }
    }
  }

  // Elevator shaft ceiling collar outlines (perimeter wireframe only — keeps upward sightline open)
  const shaftsGroup =
    mazeGroup.userData.elevatorShaftsGroup ||
    mazeGroup.getObjectByName?.('maze-elevator-shafts-group')
  const startShaft = shaftsGroup?.userData?.startShaft
  if (startShaft) {
    let startCollarOutline =
      startShaft.userData?.highContrastOutline ||
      startShaft.getObjectByName?.('start-shaft-collar-outline')
    if (enabled && !startCollarOutline) {
      const span = (startShaft.userData?.cutout?.halfSpan || 1.54) * 2
      startCollarOutline = createScaledOutlineBox({
        name: 'start-shaft-collar-outline',
        matKey: 'marker:start',
        color: HIGH_CONTRAST_COLORS.startMarker,
        width: span,
        height: 0.16,
        depth: span,
        y: 3.58,
      })
      startShaft.add(startCollarOutline)
      startShaft.userData = {
        ...(startShaft.userData || {}),
        highContrastOutline: startCollarOutline,
      }
    }
    if (startCollarOutline) {
      startCollarOutline.visible = Boolean(enabled)
    }
  }

  const exitShaft = shaftsGroup?.userData?.exitShaft
  if (exitShaft) {
    const isLocked = Boolean(exitGate?.userData?.isLocked)
    let exitCollarOutline =
      exitShaft.userData?.highContrastOutline ||
      exitShaft.getObjectByName?.('exit-shaft-collar-outline')
    if (enabled && !exitCollarOutline) {
      const span = (exitShaft.userData?.cutout?.halfSpan || 1.54) * 2
      const matKey = isLocked ? 'marker:exit:locked' : 'marker:exit:unlocked'
      const color = isLocked
        ? HIGH_CONTRAST_COLORS.exitLocked
        : HIGH_CONTRAST_COLORS.exitUnlocked
      exitCollarOutline = createScaledOutlineBox({
        name: 'exit-shaft-collar-outline',
        matKey,
        color,
        width: span,
        height: 0.18,
        depth: span,
        y: 3.54,
      })
      exitShaft.add(exitCollarOutline)
      exitShaft.userData = {
        ...(exitShaft.userData || {}),
        highContrastOutline: exitCollarOutline,
      }
    }
    if (exitCollarOutline) {
      exitCollarOutline.visible = Boolean(enabled)
      if (enabled) {
        syncExitShaftOutlineColor(exitShaft, isLocked)
      }
    }
  }
}

export function syncExitShaftOutlineColor(exitShaft, isLocked) {
  const outline =
    exitShaft?.userData?.highContrastOutline ||
    exitShaft?.getObjectByName?.('exit-shaft-collar-outline')
  if (!outline) return
  const matKey = isLocked ? 'marker:exit:locked' : 'marker:exit:unlocked'
  const color = isLocked
    ? HIGH_CONTRAST_COLORS.exitLocked
    : HIGH_CONTRAST_COLORS.exitUnlocked
  const nextMat = getPooledOutlineMaterial(matKey, color)
  if (outline.isLineSegments) {
    outline.material = nextMat
  } else {
    outline.traverse?.((node) => {
      if (node.isLineSegments) {
        node.material = nextMat
      }
    })
  }
}

export function syncExitGateOutlineColor(
  exitGate,
  isLocked,
  elevatorShaftsGroup = null
) {
  const matKey = isLocked ? 'marker:exit:locked' : 'marker:exit:unlocked'
  const color = isLocked
    ? HIGH_CONTRAST_COLORS.exitLocked
    : HIGH_CONTRAST_COLORS.exitUnlocked
  const nextMat = getPooledOutlineMaterial(matKey, color)

  const outline = exitGate?.userData?.highContrastOutline
  if (outline) {
    outline.traverse?.((node) => {
      if (node.isLineSegments) {
        node.material = nextMat
      }
    })
  }
  const cabOutline = exitGate?.userData?.cabinGroup?.userData?.highContrastOutline
  if (cabOutline) {
    if (cabOutline.isLineSegments) {
      cabOutline.material = nextMat
    } else {
      cabOutline.traverse?.((node) => {
        if (node.isLineSegments) {
          node.material = nextMat
        }
      })
    }
  }
  const resolvedShafts =
    elevatorShaftsGroup ||
    exitGate?.parent?.userData?.elevatorShaftsGroup ||
    exitGate?.parent?.getObjectByName?.('maze-elevator-shafts-group')
  const exitShaft = resolvedShafts?.userData?.exitShaft
  if (exitShaft) {
    syncExitShaftOutlineColor(exitShaft, isLocked)
  }
}

export function syncCollectibleHighContrast(mesh, enabled) {
  if (!mesh?.userData) return
  let outline = mesh.userData.highContrastOutline

  if (enabled && !outline) {
    const kind =
      mesh.userData.collectibleKind ||
      (mesh.userData.ringMesh && mesh.userData.moteMesh ? 'echo_marker' : null)
    if (kind === 'coin') {
      outline = createScaledOutlineRing({
        name: 'high-contrast-outline',
        matKey: 'collectible:coin',
        color: HIGH_CONTRAST_COLORS.coin,
        radius: 0.42,
        height: 0.16,
        rotX: Math.PI / 2,
      })
    } else if (kind === 'keycard') {
      outline = createScaledOutlineBox({
        name: 'high-contrast-outline',
        matKey: 'collectible:keycard',
        color: HIGH_CONTRAST_COLORS.keycard,
        width: 0.62,
        height: 0.84,
        depth: 0.24,
      })
    } else if (kind === 'echo_marker') {
      outline = createScaledOutlineRing({
        name: 'high-contrast-outline',
        matKey: 'collectible:echo',
        color: HIGH_CONTRAST_COLORS.echoMarker,
        radius: 0.34,
        height: 0.14,
        y: 0.08,
      })
    } else {
      const puType = mesh.userData.powerUpType
      const matKey =
        puType === POWERUP_TYPES.ECHO_REVEAL
          ? 'collectible:pu:echo'
          : puType === POWERUP_TYPES.COIN_MAGNET
            ? 'collectible:pu:magnet'
            : 'collectible:pu:wallpass'
      const color =
        puType === POWERUP_TYPES.ECHO_REVEAL
          ? HIGH_CONTRAST_COLORS.echoReveal
          : puType === POWERUP_TYPES.COIN_MAGNET
            ? HIGH_CONTRAST_COLORS.coinMagnet
            : HIGH_CONTRAST_COLORS.wallPass
      outline = createScaledOutlineBox({
        name: 'high-contrast-outline',
        matKey,
        color,
        width: 0.84,
        height: 0.88,
        depth: 0.84,
      })
    }
    mesh.add(outline)
    mesh.userData.highContrastOutline = outline
  }

  if (outline) {
    outline.visible = Boolean(enabled)
  }
}

export function syncHazardHighContrast(hazardRoot, enabled) {
  if (!hazardRoot?.userData) return
  let outline = hazardRoot.userData.highContrastOutline

  if (enabled && !outline) {
    const type = hazardRoot.userData.hazardType
    const size = CELL_SIZE * 0.88
    if (type === HAZARD_TYPES.PRESSURE_PLATE) {
      outline = createScaledOutlineBox({
        name: 'high-contrast-outline',
        matKey: 'hazard:plate',
        color: HIGH_CONTRAST_COLORS.hazardPlate,
        width: size * 0.92,
        height: 0.18,
        depth: size * 0.92,
        y: 0.09,
      })
    } else if (type === HAZARD_TYPES.ELECTRIC_GRID) {
      outline = createScaledOutlineBox({
        name: 'high-contrast-outline',
        matKey: 'hazard:electric',
        color: HIGH_CONTRAST_COLORS.hazardElectric,
        width: size,
        height: 0.16,
        depth: size,
        y: 0.08,
      })
    } else {
      outline = createScaledOutlineBox({
        name: 'high-contrast-outline',
        matKey: 'hazard:spikes',
        color: HIGH_CONTRAST_COLORS.hazardSpikes,
        width: size,
        height: 0.56,
        depth: size,
        y: 0.28,
      })
    }
    hazardRoot.add(outline)
    hazardRoot.userData.highContrastOutline = outline
  }

  if (outline) {
    outline.visible = Boolean(enabled)
  }
}

export function syncHidingSpotHighContrast(spotRoot, enabled) {
  if (!spotRoot?.userData) return
  let outline = spotRoot.userData.highContrastOutline

  if (enabled && !outline) {
    const isCabinet = spotRoot.userData.spotType === HIDING_SPOT_TYPES.SUPPLY_CABINET
    const width = (isCabinet ? 1.38 : 1.24) + 0.12
    const height = (isCabinet ? 2.18 : 2.34) + 0.06
    const depth = (isCabinet ? 1.12 : 1.06) + 0.1
    outline = createScaledOutlineBox({
      name: 'high-contrast-outline',
      matKey: 'hiding:spot',
      color: HIGH_CONTRAST_COLORS.hidingSpot,
      width,
      height,
      depth,
      y: height / 2,
    })
    spotRoot.add(outline)
    spotRoot.userData.highContrastOutline = outline
  }

  if (outline) {
    outline.visible = Boolean(enabled)
  }
}

const ENEMY_OUTLINE_BOUNDS = {
  stalker: { width: 0.88, height: 2.3, depth: 0.86, y: 1.15 },
  hunter: { width: 0.78, height: 1.98, depth: 0.8, y: 0.99 },
  brute: { width: 0.98, height: 2.26, depth: 0.9, y: 1.13 },
}

export function syncEnemyHighContrast(enemyRoot, enabled) {
  if (!enemyRoot?.userData?.rig) return
  let outline = enemyRoot.userData.highContrastOutline

  if (enabled && !outline) {
    const parent = enemyRoot.userData.rig.scaleGroup || enemyRoot
    const bounds =
      ENEMY_OUTLINE_BOUNDS[enemyRoot.userData.enemyType] || ENEMY_OUTLINE_BOUNDS.stalker
    outline = createScaledOutlineBox({
      name: 'high-contrast-outline',
      matKey: 'enemy:threat',
      color: HIGH_CONTRAST_COLORS.enemy,
      width: bounds.width,
      height: bounds.height,
      depth: bounds.depth,
      y: bounds.y,
    })
    parent.add(outline)
    enemyRoot.userData.highContrastOutline = outline
  }

  if (outline) {
    outline.visible = Boolean(enabled)
  }
}

/**
 * Applies or clears High-Contrast Outlines across all active maze walls, exit/start
 * markers, collectibles, hiding spots, environmental hazards, and enemies.
 */
export function applyHighContrastToScene({
  mazeGroup = null,
  collectibleManager = null,
  hazardManager = null,
  hidingSpotManager = null,
  enemyManager = null,
  enabled = false,
} = {}) {
  const active = Boolean(enabled)

  if (mazeGroup) {
    syncMazeGroupContrast(mazeGroup, active)
  }

  if (collectibleManager) {
    for (const entry of collectibleManager.coins?.values?.() || []) {
      syncCollectibleHighContrast(entry.mesh, active)
    }
    for (const entry of collectibleManager.powerUps?.values?.() || []) {
      syncCollectibleHighContrast(entry.mesh, active)
    }
    for (const entry of collectibleManager.keycards?.values?.() || []) {
      syncCollectibleHighContrast(entry.mesh, active)
    }
    for (const entry of collectibleManager.echoMarkers?.values?.() || []) {
      syncCollectibleHighContrast(entry.mesh, active)
    }
  }

  if (hazardManager) {
    for (const hazard of hazardManager.getHazards?.() || []) {
      syncHazardHighContrast(hazard.getMesh?.(), active)
    }
  }

  if (hidingSpotManager) {
    for (const spot of hidingSpotManager.getHidingSpots?.() || []) {
      syncHidingSpotHighContrast(spot.getMesh?.(), active)
    }
  }

  if (enemyManager) {
    for (const enemy of enemyManager.getEnemies?.() || []) {
      syncEnemyHighContrast(enemy.getMesh?.(), active)
    }
  }
}
