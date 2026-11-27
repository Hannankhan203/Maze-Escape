import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { CELL_TYPES } from './mazeConfig.js'
import { HAZARD_TYPES } from './hazardTypes.js'
import { validateMaze } from './pathfinder.js'
import {
  DEFAULT_HIDING_INTERACT_RANGE,
  HIDING_SPOT_CONFIG,
  HIDING_SPOT_TYPES,
  localToWorldSpotOffset,
} from '../mechanics/hidingConfig.js'

/**
 * Shared geometric, collider, danger-zone, and interaction-clearance
 * coexistence rules between environmental hazards and hiding spots.
 *
 * Uses actual runtime geometry & collision footprints (matching HazardAgent.js
 * and hidingConfig.js) rather than relying solely on grid cell equality.
 */

const GEOMETRY_OVERLAP_PAD = 0.18
const ENTRANCE_COLLIDER_CLEARANCE = PLAYER_RADIUS + 0.08 // 0.83m from entryAnchor center
const ENTRANCE_DANGER_CLEARANCE = 0.45 // buffer around active hazard danger/surge zones
const INTERACTION_COLLIDER_CLEARANCE = PLAYER_RADIUS + 0.06 // 0.81m around valve/breaker/clear anchors
const INTERACTION_PROMPT_MIN_SEPARATION = 1.95 // avoid prompt hijacking across open corridors
const ADJACENT_PASSAGE_MIN_CLEARANCE = PLAYER_RADIUS * 2 + 0.1 // >= 1.60m navigable lane

const HAZARD_DEFAULT_TRIGGER_RADIUS = Object.freeze({
  [HAZARD_TYPES.CEILING_COLLAPSE]: 2.2,
  [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE]: 2.15,
  [HAZARD_TYPES.FALLING_PIPES_FIXTURES]: 2.15,
  [HAZARD_TYPES.STEAM_PIPE_BURST]: 2.15,
  [HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]: 2.15,
  [HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]: 0.98,
  [HAZARD_TYPES.WALL_COLLAPSE]: 2.15,
  [HAZARD_TYPES.FALLING_WATER_TANK]: 2.4,
  [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]: 2.5,
  [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]: 2.45,
})

const HAZARD_DEFAULT_DANGER_RADIUS = Object.freeze({
  [HAZARD_TYPES.CEILING_COLLAPSE]: 3.4,
  [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE]: 1.18,
  [HAZARD_TYPES.FALLING_PIPES_FIXTURES]: 1.18,
  [HAZARD_TYPES.STEAM_PIPE_BURST]: 1.28,
  [HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]: 0.98,
  [HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]: 0.88,
  [HAZARD_TYPES.WALL_COLLAPSE]: 1.15,
  [HAZARD_TYPES.FALLING_WATER_TANK]: 1.15,
  [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]: 1.25,
  [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]: 1.2,
})

function localToWorld(baseX, baseZ, yaw, lx, lz) {
  const cos = Math.cos(yaw || 0)
  const sin = Math.sin(yaw || 0)
  return {
    x: baseX + lx * cos + lz * sin,
    z: baseZ - lx * sin + lz * cos,
  }
}

function makeWorldAabbFromObb(cx, cz, halfW, halfD, yaw = 0, label = 'box') {
  const cos = Math.abs(Math.cos(yaw || 0))
  const sin = Math.abs(Math.sin(yaw || 0))
  const hx = halfW * cos + halfD * sin
  const hz = halfW * sin + halfD * cos
  return {
    label,
    cx,
    cz,
    halfW: hx,
    halfD: hz,
    minX: cx - hx,
    maxX: cx + hx,
    minZ: cz - hz,
    maxZ: cz + hz,
  }
}

function makeWorldAabbFromLocalRect(baseX, baseZ, yaw, minLx, maxLx, minLz, maxLz, label = 'rect') {
  const centerLx = (minLx + maxLx) * 0.5
  const centerLz = (minLz + maxLz) * 0.5
  const halfW = Math.abs(maxLx - minLx) * 0.5
  const halfD = Math.abs(maxLz - minLz) * 0.5
  const center = localToWorld(baseX, baseZ, yaw, centerLx, centerLz)
  return makeWorldAabbFromObb(center.x, center.z, halfW, halfD, yaw, label)
}

function aabbsOverlap(a, b, pad = 0) {
  if (!a || !b) return false
  return !(
    a.maxX + pad < b.minX ||
    a.minX - pad > b.maxX ||
    a.maxZ + pad < b.minZ ||
    a.minZ - pad > b.maxZ
  )
}

function pointToAabbDistance(px, pz, box) {
  const dx = Math.max(box.minX - px, 0, px - box.maxX)
  const dz = Math.max(box.minZ - pz, 0, pz - box.maxZ)
  return Math.hypot(dx, dz)
}

function aabbToAabbDistance(a, b) {
  const dx = Math.max(a.minX - b.maxX, 0, b.minX - a.maxX)
  const dz = Math.max(a.minZ - b.maxZ, 0, b.minZ - a.maxZ)
  return Math.hypot(dx, dz)
}

/**
 * Checks whether two cells have a direct open corridor connection without an
 * intervening solid maze wall.
 * - Manhattan distance 0: always connected.
 * - Manhattan distance 1: directly connected if both cells are walkable PATH.
 * - Diagonal (|dr| === 1 && |dc| === 1): connected only if at least one shared
 *   orthogonal corner cell is walkable PATH.
 * - Manhattan distance 2 straight: connected only if the intermediate cell is PATH.
 */
export function areCellsDirectlyOpen(grid, r1, c1, r2, c2) {
  if (!Array.isArray(grid) || grid.length === 0) return true
  const dr = r2 - r1
  const dc = c2 - c1
  const absR = Math.abs(dr)
  const absC = Math.abs(dc)
  if (absR === 0 && absC === 0) return true
  if (absR + absC === 1) {
    return grid[r1]?.[c1] === CELL_TYPES.PATH && grid[r2]?.[c2] === CELL_TYPES.PATH
  }
  if (absR === 1 && absC === 1) {
    return (
      grid[r1 + dr]?.[c1] === CELL_TYPES.PATH ||
      grid[r1]?.[c1 + dc] === CELL_TYPES.PATH
    )
  }
  if ((absR === 2 && absC === 0) || (absR === 0 && absC === 2)) {
    const midR = r1 + dr / 2
    const midC = c1 + dc / 2
    return grid[midR]?.[midC] === CELL_TYPES.PATH
  }
  return false
}

/**
 * Resolves exact world-space geometry, collider, floor cutout, and entrance
 * approach bounds for a hiding spot spec.
 */
export function getHidingSpotFootprint(spot, maze) {
  if (!spot || !spot.type) return null
  const cfg = HIDING_SPOT_CONFIG[spot.type]
  const p = cfg?.placement
  if (!p) return null

  let x = spot.x
  let z = spot.z
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    const cellWorld =
      maze && Number.isInteger(spot.row) && Number.isInteger(spot.col)
        ? gridToWorld(spot.row, spot.col, maze)
        : null
    if (!cellWorld) return null
    x = cellWorld.x
    z = cellWorld.z
  }

  const yaw = Number.isFinite(spot.wallYaw) ? spot.wallYaw : 0
  const halfDepth = Math.max(p.halfDepthBack || 0.4, p.halfDepthFront || 0.4)
  const halfWidth = p.halfWidth || 0.7
  const bodyBox = makeWorldAabbFromObb(x, z, halfWidth, halfDepth, yaw, 'hiding_body')

  let colliderBox = null
  if (p.colliderSpec) {
    const cCenter = localToWorldSpotOffset(
      x,
      z,
      yaw,
      p.colliderSpec.localX || 0,
      p.colliderSpec.localZ || 0
    )
    colliderBox = makeWorldAabbFromObb(
      cCenter.x,
      cCenter.z,
      p.colliderSpec.halfW || halfWidth,
      p.colliderSpec.halfD || halfDepth,
      yaw,
      'hiding_collider'
    )
  }

  let floorCutoutBox = null
  if (spot.type === HIDING_SPOT_TYPES.FLOOR_HATCH) {
    floorCutoutBox = makeWorldAabbFromObb(
      x,
      z,
      p.pitHalfW || 0.56,
      p.pitHalfD || 0.56,
      yaw,
      'floor_hatch_cutout'
    )
  }

  const fallbackEntry = localToWorldSpotOffset(
    x,
    z,
    yaw,
    p.entryLocal?.x || 0,
    p.entryLocal?.z || 0.9
  )
  const entryAnchor = {
    x: Number.isFinite(spot.entryAnchor?.x) ? spot.entryAnchor.x : fallbackEntry.x,
    z: Number.isFinite(spot.entryAnchor?.z) ? spot.entryAnchor.z : fallbackEntry.z,
  }

  const fallbackInterior = localToWorldSpotOffset(
    x,
    z,
    yaw,
    p.interiorLocal?.x || 0,
    p.interiorLocal?.z || 0
  )
  const interiorAnchor = {
    x: Number.isFinite(spot.interiorAnchor?.x) ? spot.interiorAnchor.x : fallbackInterior.x,
    z: Number.isFinite(spot.interiorAnchor?.z) ? spot.interiorAnchor.z : fallbackInterior.z,
  }

  return {
    id: spot.id || `hiding-${spot.type}-${spot.row}-${spot.col}`,
    type: spot.type,
    row: spot.row,
    col: spot.col,
    wallSide: spot.wallSide || null,
    wallYaw: yaw,
    x,
    z,
    bodyBox,
    colliderBox,
    blocksWhenEmpty: Boolean(p.colliderSpec?.blocksWhenEmpty),
    floorCutoutBox,
    entryAnchor,
    interiorAnchor,
    interactRange: cfg.triggerRadius || DEFAULT_HIDING_INTERACT_RANGE,
  }
}

/**
 * Resolves exact world-space colliders (dormant + aftermath), active danger /
 * surge / plume zones, floor cutouts, trigger radius, and interaction anchor
 * for any of the 10 hazard types.
 */
export function getHazardFootprint(hazard, maze) {
  if (!hazard || !hazard.type || !Number.isInteger(hazard.row) || !Number.isInteger(hazard.col)) {
    return null
  }
  const cellCenter = gridToWorld(hazard.row, hazard.col, maze)
  if (!cellCenter) return null

  const baseX = cellCenter.x
  const baseZ = cellCenter.z
  const type = hazard.type

  const colliders = []
  const dangerBoxes = []
  const dangerCircles = []
  let floorCutoutBox = null
  let triggerCenter = { x: baseX, z: baseZ }
  const triggerRadius = HAZARD_DEFAULT_TRIGGER_RADIUS[type] ?? 2.15
  let interactionAnchor = { x: baseX, z: baseZ }
  let waterSurge = null

  if (type === HAZARD_TYPES.CEILING_COLLAPSE) {
    const yaw = Number.isFinite(hazard.collapseYaw) ? hazard.collapseYaw : 0
    const ox = Number(hazard.localPatchOffset?.x) || 0
    const oz = Number(hazard.localPatchOffset?.z) || 0
    const cx = baseX + ox
    const cz = baseZ + oz
    const hw = Number.isFinite(hazard.rubbleHalfW) ? hazard.rubbleHalfW : 1.84
    const hd = Number.isFinite(hazard.rubbleHalfD) ? hazard.rubbleHalfD : 3.0
    const rubCenterLz = Number.isFinite(hazard.rubbleCenterLocalZ) ? hazard.rubbleCenterLocalZ : 0
    const rubCenter = localToWorld(cx, cz, yaw, 0, rubCenterLz)
    colliders.push(makeWorldAabbFromObb(rubCenter.x, rubCenter.z, hw, hd, yaw, 'ceiling_rubble'))
    const dHw = Number.isFinite(hazard.dangerHalfW) ? hazard.dangerHalfW : 2.0
    const dMinZ = Number.isFinite(hazard.dangerMinLocalZ) ? hazard.dangerMinLocalZ : -3.4
    const dMaxZ = Number.isFinite(hazard.dangerMaxLocalZ) ? hazard.dangerMaxLocalZ : 3.4
    const dCenterLz = (dMinZ + dMaxZ) * 0.5
    const dHd = (dMaxZ - dMinZ) * 0.5
    const dCenter = localToWorld(cx, cz, yaw, 0, dCenterLz)
    dangerBoxes.push(makeWorldAabbFromObb(dCenter.x, dCenter.z, dHw, dHd, yaw, 'ceiling_drop'))
    triggerCenter = { x: cx, z: cz }
    interactionAnchor = { x: cx, z: cz }
  } else if (type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
    const yaw = Number.isFinite(hazard.wallYaw) ? hazard.wallYaw : 0
    const lat = Number.isFinite(hazard.lateralOffset) ? hazard.lateralOffset : 0.46
    const upCenter = localToWorld(baseX, baseZ, yaw, lat, -1.73)
    const fallCenter = localToWorld(baseX, baseZ, yaw, lat, -0.82)
    colliders.push(
      makeWorldAabbFromObb(
        upCenter.x,
        upCenter.z,
        Number.isFinite(hazard.uprightHalfW) ? hazard.uprightHalfW : 0.45,
        Number.isFinite(hazard.uprightHalfD) ? hazard.uprightHalfD : 0.23,
        yaw,
        'furniture_dormant'
      ),
      makeWorldAabbFromObb(
        fallCenter.x,
        fallCenter.z,
        Number.isFinite(hazard.aftermathHalfW) ? hazard.aftermathHalfW : 0.46,
        Number.isFinite(hazard.aftermathHalfD) ? hazard.aftermathHalfD : 0.72,
        yaw,
        'furniture_aftermath'
      )
    )
    const impX = baseX + (Number(hazard.localImpactOffset?.x) || (fallCenter.x - baseX))
    const impZ = baseZ + (Number(hazard.localImpactOffset?.z) || (fallCenter.z - baseZ))
    dangerCircles.push({
      x: impX,
      z: impZ,
      radius: HAZARD_DEFAULT_DANGER_RADIUS[type],
      label: 'furniture_tip',
    })
    triggerCenter = { x: impX, z: impZ }
    interactionAnchor = { x: impX, z: impZ }
  } else if (type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
    const yaw = Number.isFinite(hazard.pipeYaw) ? hazard.pipeYaw : 0
    const impX = baseX + (Number(hazard.localImpactOffset?.x) || 0)
    const impZ = baseZ + (Number(hazard.localImpactOffset?.z) || 0)
    colliders.push(
      makeWorldAabbFromObb(
        impX,
        impZ,
        Number.isFinite(hazard.aftermathHalfW) ? hazard.aftermathHalfW : 1.92,
        Number.isFinite(hazard.aftermathHalfD) ? hazard.aftermathHalfD : 0.24,
        yaw,
        'fallen_pipe'
      )
    )
    dangerBoxes.push(
      makeWorldAabbFromObb(
        impX,
        impZ,
        Number.isFinite(hazard.dangerHalfW) ? hazard.dangerHalfW : 1.92,
        Number.isFinite(hazard.dangerHalfD) ? hazard.dangerHalfD : 0.68,
        yaw,
        'falling_pipe_zone'
      )
    )
    triggerCenter = { x: impX, z: impZ }
    interactionAnchor = { x: impX, z: impZ }
  } else if (type === HAZARD_TYPES.STEAM_PIPE_BURST) {
    const yaw = Number.isFinite(hazard.steamYaw) ? hazard.steamYaw : 0
    const centerLx = Number.isFinite(hazard.dangerCenterLocalX) ? hazard.dangerCenterLocalX : 0.12
    const halfW = Number.isFinite(hazard.dangerHalfW) ? hazard.dangerHalfW : 1.28
    const minLz = Number.isFinite(hazard.dangerMinLocalZ)
      ? hazard.dangerMinLocalZ
      : hazard.mountType === 'ceiling'
        ? -1.45
        : -1.82
    const maxLz = Number.isFinite(hazard.dangerMaxLocalZ) ? hazard.dangerMaxLocalZ : 0.74
    dangerBoxes.push(
      makeWorldAabbFromLocalRect(
        baseX,
        baseZ,
        yaw,
        centerLx - halfW,
        centerLx + halfW,
        minLz,
        maxLz,
        'steam_plume'
      )
    )
    const valveX = baseX + (Number(hazard.localValveOffset?.x) || 0)
    const valveZ = baseZ + (Number(hazard.localValveOffset?.z) || 0)
    const impX = baseX + (Number(hazard.localImpactOffset?.x) || 0)
    const impZ = baseZ + (Number(hazard.localImpactOffset?.z) || 0)
    triggerCenter = { x: impX, z: impZ }
    interactionAnchor = { x: valveX, z: valveZ }
  } else if (type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
    const disX = baseX + (Number(hazard.localDischargeOffset?.x) || 0)
    const disZ = baseZ + (Number(hazard.localDischargeOffset?.z) || 0)
    const brkX = baseX + (Number(hazard.localBreakerOffset?.x) || 0)
    const brkZ = baseZ + (Number(hazard.localBreakerOffset?.z) || 0)
    dangerCircles.push({
      x: disX,
      z: disZ,
      radius: HAZARD_DEFAULT_DANGER_RADIUS[type],
      label: 'electrical_discharge',
    })
    triggerCenter = { x: disX, z: disZ }
    interactionAnchor = { x: brkX, z: brkZ }
  } else if (type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
    const yaw = Number.isFinite(hazard.grateYaw) ? hazard.grateYaw : 0
    const ox = Number(hazard.localPitOffset?.x) || 0
    const oz = Number(hazard.localPitOffset?.z) || 0
    const cx = baseX + ox
    const cz = baseZ + oz
    const frameW = Number.isFinite(hazard.frameOuterHalfW) ? hazard.frameOuterHalfW : 0.67
    const frameD = Number.isFinite(hazard.frameOuterHalfD) ? hazard.frameOuterHalfD : 0.73
    const colW = Number.isFinite(hazard.aftermathHalfW) ? hazard.aftermathHalfW : 0.62
    const colD = Number.isFinite(hazard.aftermathHalfD) ? hazard.aftermathHalfD : 0.68
    floorCutoutBox = makeWorldAabbFromObb(cx, cz, frameW, frameD, yaw, 'floor_grate_cutout')
    colliders.push(makeWorldAabbFromObb(cx, cz, colW, colD, yaw, 'floor_grate_pit'))
    dangerBoxes.push(makeWorldAabbFromObb(cx, cz, frameW, frameD, yaw, 'floor_grate_danger'))
    triggerCenter = { x: cx, z: cz }
    interactionAnchor = { x: cx, z: cz }
  } else if (type === HAZARD_TYPES.WALL_COLLAPSE) {
    const yaw = Number.isFinite(hazard.wallYaw) ? hazard.wallYaw : 0
    const rubbleCenter = localToWorld(baseX, baseZ, yaw, 0, -1.42)
    colliders.push(
      makeWorldAabbFromObb(
        rubbleCenter.x,
        rubbleCenter.z,
        Number.isFinite(hazard.aftermathHalfW) ? hazard.aftermathHalfW : 1.08,
        Number.isFinite(hazard.aftermathHalfD) ? hazard.aftermathHalfD : 0.58,
        yaw,
        'wall_collapse_rubble'
      )
    )
    dangerBoxes.push(
      makeWorldAabbFromLocalRect(baseX, baseZ, yaw, -1.14, 1.14, -2.04, -0.76, 'wall_collapse_zone')
    )
    const impX = baseX + (Number(hazard.localImpactOffset?.x) || (rubbleCenter.x - baseX))
    const impZ = baseZ + (Number(hazard.localImpactOffset?.z) || (rubbleCenter.z - baseZ))
    triggerCenter = { x: impX, z: impZ }
    interactionAnchor = { x: rubbleCenter.x, z: rubbleCenter.z }
  } else if (type === HAZARD_TYPES.FALLING_WATER_TANK) {
    const yaw = Number.isFinite(hazard.tankYaw) ? hazard.tankYaw : 0
    const sideSign = Number.isFinite(hazard.sideSign) && hazard.sideSign !== 0 ? Math.sign(hazard.sideSign) : 1
    const fallenCenter = localToWorld(baseX, baseZ, yaw, sideSign * 0.86, -0.36)
    colliders.push(
      makeWorldAabbFromObb(
        fallenCenter.x,
        fallenCenter.z,
        Number.isFinite(hazard.aftermathHalfW) ? hazard.aftermathHalfW : 0.45,
        Number.isFinite(hazard.aftermathHalfD) ? hazard.aftermathHalfD : 0.7,
        yaw,
        'fallen_water_tank'
      )
    )
    dangerCircles.push({
      x: baseX,
      z: baseZ,
      radius: HAZARD_DEFAULT_DANGER_RADIUS[type],
      label: 'water_tank_drop',
    })
    const flowDir = hazard.flowDir || { x: Math.sin(yaw), z: Math.cos(yaw) }
    const surgeLength = Number.isFinite(hazard.surgeLength) ? hazard.surgeLength : 2.55
    const surgeHalfWidth = Number.isFinite(hazard.surgeHalfWidth) ? hazard.surgeHalfWidth : 1.05
    waterSurge = {
      originX: baseX,
      originZ: baseZ,
      flowDirX: flowDir.x,
      flowDirZ: flowDir.z,
      surgeLength,
      surgeHalfWidth,
    }
    dangerBoxes.push(
      makeWorldAabbFromLocalRect(
        baseX,
        baseZ,
        yaw,
        -surgeHalfWidth,
        surgeHalfWidth,
        -0.4,
        surgeLength,
        'water_surge_corridor'
      )
    )
    triggerCenter = { x: baseX, z: baseZ }
    interactionAnchor = { x: fallenCenter.x, z: fallenCenter.z }
  } else if (type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
    const yaw = Number.isFinite(hazard.machineryYaw) ? hazard.machineryYaw : 0
    const sideSign = Number.isFinite(hazard.sideSign) && hazard.sideSign !== 0 ? Math.sign(hazard.sideSign) : 1
    const fallenCenter = localToWorld(baseX, baseZ, yaw, sideSign * 0.96, 0.68)
    const afterYaw = yaw + (Number.isFinite(hazard.aftermathYawOffset) ? hazard.aftermathYawOffset : sideSign * 1.48)
    colliders.push(
      makeWorldAabbFromObb(
        fallenCenter.x,
        fallenCenter.z,
        Number.isFinite(hazard.aftermathHalfW) ? hazard.aftermathHalfW : 0.46,
        Number.isFinite(hazard.aftermathHalfD) ? hazard.aftermathHalfD : 0.31,
        afterYaw,
        'fallen_machinery'
      )
    )
    const impX = baseX + (Number(hazard.localImpactOffset?.x) || 0)
    const impZ = baseZ + (Number(hazard.localImpactOffset?.z) || 0)
    dangerCircles.push({
      x: impX,
      z: impZ,
      radius: HAZARD_DEFAULT_DANGER_RADIUS[type],
      label: 'machinery_swing_impact',
    })
    triggerCenter = { x: baseX, z: baseZ }
    interactionAnchor = { x: fallenCenter.x, z: fallenCenter.z }
  } else if (type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
    const yaw = Number.isFinite(hazard.ductYaw) ? hazard.ductYaw : 0
    const sideSign = Number.isFinite(hazard.sideSign) && hazard.sideSign !== 0 ? Math.sign(hazard.sideSign) : 1
    const fallenCenter = localToWorld(baseX, baseZ, yaw, sideSign * 1.12, 0.62)
    const afterYaw = yaw + (Number.isFinite(hazard.aftermathYawOffset) ? hazard.aftermathYawOffset : sideSign * 0.14)
    colliders.push(
      makeWorldAabbFromObb(
        fallenCenter.x,
        fallenCenter.z,
        Number.isFinite(hazard.aftermathHalfW) ? hazard.aftermathHalfW : 0.36,
        Number.isFinite(hazard.aftermathHalfD) ? hazard.aftermathHalfD : 0.91,
        afterYaw,
        'fallen_duct'
      )
    )
    const impX = baseX + (Number(hazard.localImpactOffset?.x) || 0)
    const impZ = baseZ + (Number(hazard.localImpactOffset?.z) || 0)
    dangerCircles.push({
      x: impX,
      z: impZ,
      radius: HAZARD_DEFAULT_DANGER_RADIUS[type],
      label: 'duct_drop_impact',
    })
    triggerCenter = { x: baseX, z: baseZ }
    interactionAnchor = { x: fallenCenter.x, z: fallenCenter.z }
  }

  return {
    id: hazard.id || `hazard-${type}-${hazard.row}-${hazard.col}`,
    type,
    row: hazard.row,
    col: hazard.col,
    cellCenter,
    colliders,
    dangerBoxes,
    dangerCircles,
    floorCutoutBox,
    triggerCenter,
    triggerRadius,
    interactionAnchor,
    waterSurge,
  }
}

/**
 * Evaluates all geometric, entrance, danger-zone, trigger, and interaction
 * coexistence constraints between one hazard and one hiding spot.
 *
 * Returns `{ conflict: false, reason: null }` when both can safely coexist,
 * or `{ conflict: true, reason, category, detail }` otherwise.
 */
export function checkHazardHidingConflict(hazard, hidingSpot, maze) {
  if (!hazard || !hidingSpot) {
    return { conflict: false, reason: null, category: null }
  }

  const hRow = hazard.row
  const hCol = hazard.col
  const sRow = hidingSpot.row
  const sCol = hidingSpot.col

  // Rule 1: Never occupy the same grid cell
  if (
    Number.isInteger(hRow) &&
    Number.isInteger(hCol) &&
    Number.isInteger(sRow) &&
    Number.isInteger(sCol) &&
    hRow === sRow &&
    hCol === sCol
  ) {
    return {
      conflict: true,
      reason: 'same_cell_overlap',
      category: 'same_cell',
      detail: `Hazard ${hazard.type} and hiding spot ${hidingSpot.type} share cell (${hRow},${hCol})`,
    }
  }

  // Fast spatial rejection: beyond 2 cells apart (> 8m), footprints cannot interact
  if (
    Number.isInteger(hRow) &&
    Number.isInteger(hCol) &&
    Number.isInteger(sRow) &&
    Number.isInteger(sCol)
  ) {
    const manhattan = Math.abs(hRow - sRow) + Math.abs(hCol - sCol)
    if (manhattan > 2) {
      return { conflict: false, reason: null, category: null }
    }
    // If a solid maze wall completely separates the two cells, they cannot physically interact
    if (maze?.grid && !areCellsDirectlyOpen(maze.grid, hRow, hCol, sRow, sCol)) {
      return { conflict: false, reason: null, category: null }
    }
  }

  const hFoot = getHazardFootprint(hazard, maze)
  const sFoot = getHidingSpotFootprint(hidingSpot, maze)
  if (!hFoot || !sFoot) {
    return { conflict: false, reason: null, category: null }
  }

  // Rule 2: Floor cutout overlap (collapsing_floor_grate vs floor_hatch)
  if (hFoot.floorCutoutBox && sFoot.floorCutoutBox) {
    if (aabbsOverlap(hFoot.floorCutoutBox, sFoot.floorCutoutBox, 0.35)) {
      return {
        conflict: true,
        reason: 'floor_cutout_overlap',
        category: 'geometry',
        detail: `Floor grate cutout overlaps floor hatch cutout`,
      }
    }
  }

  // Rule 3: Physical geometry / collider overlap & adjacent passage pinch
  for (let i = 0; i < hFoot.colliders.length; i += 1) {
    const hColBox = hFoot.colliders[i]
    if (aabbsOverlap(hColBox, sFoot.bodyBox, GEOMETRY_OVERLAP_PAD)) {
      return {
        conflict: true,
        reason: 'hazard_collider_overlaps_hiding_body',
        category: 'geometry',
        detail: `Hazard collider ${hColBox.label} overlaps hiding spot ${sFoot.type}`,
      }
    }
    if (sFoot.colliderBox && aabbsOverlap(hColBox, sFoot.colliderBox, GEOMETRY_OVERLAP_PAD)) {
      return {
        conflict: true,
        reason: 'hazard_collider_overlaps_hiding_collider',
        category: 'geometry',
        detail: `Hazard collider ${hColBox.label} overlaps hiding collider`,
      }
    }

    // Rule 4: Hiding spot entrance must not be blocked by hazard dormant/aftermath colliders
    const entryDist = pointToAabbDistance(sFoot.entryAnchor.x, sFoot.entryAnchor.z, hColBox)
    if (entryDist < ENTRANCE_COLLIDER_CLEARANCE) {
      return {
        conflict: true,
        reason: 'hiding_entrance_obstructed_by_hazard_collider',
        category: 'entrance',
        detail: `Hiding entrance is ${entryDist.toFixed(2)}m from ${hColBox.label} (min ${ENTRANCE_COLLIDER_CLEARANCE.toFixed(2)}m)`,
      }
    }

    // Rule 5: Adjacent corridor pinch check between solid hiding collider and solid hazard collider
    if (sFoot.blocksWhenEmpty && sFoot.colliderBox) {
      const gap = aabbToAabbDistance(hColBox, sFoot.colliderBox)
      if (gap < ADJACENT_PASSAGE_MIN_CLEARANCE) {
        // Verify whether they pinch the same corridor lane (within shared cell-edge span)
        const alignedX = Math.abs(hColBox.cx - sFoot.colliderBox.cx) < CELL_SIZE * 0.75
        const alignedZ = Math.abs(hColBox.cz - sFoot.colliderBox.cz) < CELL_SIZE * 0.75
        if (alignedX && alignedZ) {
          return {
            conflict: true,
            reason: 'adjacent_passage_pinched',
            category: 'clearance',
            detail: `Gap ${gap.toFixed(2)}m between ${hColBox.label} and ${sFoot.type} < ${ADJACENT_PASSAGE_MIN_CLEARANCE.toFixed(2)}m`,
          }
        }
      }
    }
  }

  // Rule 6: Hazard active danger / surge / plume zones must not intrude on hiding body or entrance
  for (let i = 0; i < hFoot.dangerBoxes.length; i += 1) {
    const dBox = hFoot.dangerBoxes[i]
    if (aabbsOverlap(dBox, sFoot.bodyBox, 0.25)) {
      return {
        conflict: true,
        reason: 'hazard_danger_zone_overlaps_hiding_body',
        category: 'danger_zone',
        detail: `Danger zone ${dBox.label} intrudes into ${sFoot.type} body`,
      }
    }
    const entryDist = pointToAabbDistance(sFoot.entryAnchor.x, sFoot.entryAnchor.z, dBox)
    if (entryDist < ENTRANCE_DANGER_CLEARANCE) {
      return {
        conflict: true,
        reason: 'hazard_danger_zone_overlaps_hiding_entrance',
        category: 'danger_zone',
        detail: `Danger zone ${dBox.label} is ${entryDist.toFixed(2)}m from hiding entrance`,
      }
    }
  }

  for (let i = 0; i < hFoot.dangerCircles.length; i += 1) {
    const dc = hFoot.dangerCircles[i]
    const bodyDist = pointToAabbDistance(dc.x, dc.z, sFoot.bodyBox)
    if (bodyDist < dc.radius + 0.15) {
      return {
        conflict: true,
        reason: 'hazard_danger_radius_overlaps_hiding_body',
        category: 'danger_zone',
        detail: `Danger radius ${dc.label} reaches ${sFoot.type} body`,
      }
    }
    const entryDist = Math.hypot(sFoot.entryAnchor.x - dc.x, sFoot.entryAnchor.z - dc.z)
    if (entryDist < dc.radius + ENTRANCE_DANGER_CLEARANCE) {
      return {
        conflict: true,
        reason: 'hazard_danger_radius_overlaps_hiding_entrance',
        category: 'danger_zone',
        detail: `Danger radius ${dc.label} intrudes into hiding entrance`,
      }
    }
  }

  // Rule 7: Directional water surge safety margin when flowing directly toward an adjacent hiding spot
  if (hFoot.waterSurge) {
    const { originX, originZ, flowDirX, flowDirZ, surgeLength, surgeHalfWidth } = hFoot.waterSurge
    const entryDx = sFoot.entryAnchor.x - originX
    const entryDz = sFoot.entryAnchor.z - originZ
    const along = entryDx * flowDirX + entryDz * flowDirZ
    const perp = Math.abs(entryDx * -flowDirZ + entryDz * flowDirX)
    if (
      along >= -0.25 &&
      along <= surgeLength + PLAYER_RADIUS + 0.15 &&
      perp <= surgeHalfWidth + PLAYER_RADIUS * 0.5
    ) {
      return {
        conflict: true,
        reason: 'water_surge_reaches_hiding_entrance',
        category: 'danger_zone',
        detail: `Water surge (${surgeLength}m) reaches hiding entrance at along=${along.toFixed(2)}m`,
      }
    }
  }

  // Rule 8: Standing at hiding spot entrance must NOT involuntarily trigger an adjacent open-corridor hazard
  const trigDist = Math.hypot(
    sFoot.entryAnchor.x - hFoot.triggerCenter.x,
    sFoot.entryAnchor.z - hFoot.triggerCenter.z
  )
  if (trigDist < hFoot.triggerRadius + 0.12) {
    return {
      conflict: true,
      reason: 'hiding_entrance_triggers_adjacent_hazard',
      category: 'entrance',
      detail: `Hiding entrance is ${trigDist.toFixed(2)}m from ${hFoot.type} trigger (radius ${hFoot.triggerRadius}m)`,
    }
  }

  // Rule 9: Hazard interaction anchor (steam valve, electrical breaker, clearable rubble)
  // must not be blocked by the hiding spot collider or overlap hiding entrance prompt zone
  const hInter = hFoot.interactionAnchor
  const interToBody = pointToAabbDistance(hInter.x, hInter.z, sFoot.bodyBox)
  if (interToBody < INTERACTION_COLLIDER_CLEARANCE) {
    return {
      conflict: true,
      reason: 'hazard_interaction_obstructed_by_hiding_spot',
      category: 'interaction',
      detail: `Hazard interaction anchor is ${interToBody.toFixed(2)}m from ${sFoot.type} body`,
    }
  }
  const interToEntry = Math.hypot(
    hInter.x - sFoot.entryAnchor.x,
    hInter.z - sFoot.entryAnchor.z
  )
  if (interToEntry < INTERACTION_PROMPT_MIN_SEPARATION) {
    return {
      conflict: true,
      reason: 'hazard_interaction_conflicts_with_hiding_entrance',
      category: 'interaction',
      detail: `Hazard interaction anchor and hiding entrance are only ${interToEntry.toFixed(2)}m apart`,
    }
  }

  return { conflict: false, reason: null, category: null }
}

/**
 * Checks one hiding spot candidate against an array of existing hazards.
 */
export function findHazardConflictForHidingSpot(hidingSpot, hazards, maze) {
  if (!hidingSpot || !Array.isArray(hazards) || hazards.length === 0) {
    return { conflict: false, reason: null, category: null, hazard: null }
  }
  for (let i = 0; i < hazards.length; i += 1) {
    const hazard = hazards[i]
    if (!hazard) continue
    const res = checkHazardHidingConflict(hazard, hidingSpot, maze)
    if (res.conflict) {
      return { ...res, hazard }
    }
  }
  return { conflict: false, reason: null, category: null, hazard: null }
}

/**
 * Checks one hazard candidate against an array of existing hiding spots.
 */
export function findHidingSpotConflictForHazard(hazard, hidingSpots, maze) {
  if (!hazard || !Array.isArray(hidingSpots) || hidingSpots.length === 0) {
    return { conflict: false, reason: null, category: null, hidingSpot: null }
  }
  for (let i = 0; i < hidingSpots.length; i += 1) {
    const spot = hidingSpots[i]
    if (!spot) continue
    const res = checkHazardHidingConflict(hazard, spot, maze)
    if (res.conflict) {
      return { ...res, hidingSpot: spot }
    }
  }
  return { conflict: false, reason: null, category: null, hidingSpot: null }
}

/**
 * Full cross-system placement coexistence audit for a generated maze.
 * Verifies every hazard against every hiding spot, verifies start/exit/keycard/
 * collectible/enemy exclusions, verifies maze solvability, and summarizes
 * combined shortfalls without masking missing placements.
 */
export function auditHazardHidingCoexistence(maze, options = {}) {
  const hazards = Array.isArray(options.hazards)
    ? options.hazards
    : Array.isArray(maze?.hazards)
      ? maze.hazards
      : []
  const hidingSpots = Array.isArray(options.hidingSpots)
    ? options.hidingSpots
    : Array.isArray(maze?.hidingSpots)
      ? maze.hidingSpots
      : []

  const conflicts = []
  let sameCellConflicts = 0
  let geometryConflicts = 0
  let entranceConflicts = 0
  let dangerZoneConflicts = 0
  let interactionConflicts = 0
  let clearanceConflicts = 0

  for (let i = 0; i < hazards.length; i += 1) {
    const h = hazards[i]
    if (!h) continue
    for (let j = 0; j < hidingSpots.length; j += 1) {
      const s = hidingSpots[j]
      if (!s) continue
      const res = checkHazardHidingConflict(h, s, maze)
      if (res.conflict) {
        conflicts.push({
          hazardId: h.id || null,
          hazardType: h.type,
          hazardCell: { row: h.row, col: h.col },
          hidingSpotId: s.id || null,
          hidingSpotType: s.type,
          hidingSpotCell: { row: s.row, col: s.col },
          reason: res.reason,
          category: res.category,
          detail: res.detail || null,
        })
        if (res.category === 'same_cell') sameCellConflicts += 1
        else if (res.category === 'geometry') geometryConflicts += 1
        else if (res.category === 'entrance') entranceConflicts += 1
        else if (res.category === 'danger_zone') dangerZoneConflicts += 1
        else if (res.category === 'interaction') interactionConflicts += 1
        else if (res.category === 'clearance') clearanceConflicts += 1
      }
    }
  }

  const hazardReport =
    options.hazardPlacementReport ??
    options.hazardReport ??
    maze?.hazardPlacementReport ??
    null
  const hidingReport =
    options.hidingSpotPlacementReport ??
    options.hidingReport ??
    maze?.hidingSpotPlacementReport ??
    null
  const capacityPlan =
    options.capacityPlan ?? maze?.hazardHidingCapacityPlan ?? null

  const hazardShortfallsByType = hazardReport?.missingByType
    ? { ...hazardReport.missingByType }
    : {}
  const hidingShortfallsByType = hidingReport?.missingByType
    ? { ...hidingReport.missingByType }
    : {}
  const hazardShortfallTotal = hazardReport?.missingTotal ?? 0
  const hidingShortfallTotal = hidingReport?.missingTotal ?? 0
  const combinedShortfallTotal = hazardShortfallTotal + hidingShortfallTotal

  const shortfallReasonSet = new Set()
  if (combinedShortfallTotal > 0 && capacityPlan?.reason) {
    shortfallReasonSet.add(capacityPlan.reason)
  }
  if (Array.isArray(hazardReport?.failures)) {
    for (let i = 0; i < hazardReport.failures.length; i += 1) {
      const reason = hazardReport.failures[i]?.reason
      if (reason) shortfallReasonSet.add(reason)
    }
  }
  if (Array.isArray(hidingReport?.failures)) {
    for (let i = 0; i < hidingReport.failures.length; i += 1) {
      const reason = hidingReport.failures[i]?.reason
      if (reason) shortfallReasonSet.add(reason)
    }
  }
  const shortfallReasons = Array.from(shortfallReasonSet)

  const mazeValidation =
    maze?.grid && maze?.start && maze?.exit
      ? validateMaze({ grid: maze.grid, start: maze.start, exit: maze.exit })
      : { valid: false }

  const hazardSatisfied = hazardReport ? Boolean(hazardReport.fullySatisfied) : true
  const hidingSatisfied = hidingReport ? Boolean(hidingReport.fullySatisfied) : true

  return {
    valid: conflicts.length === 0 && Boolean(mazeValidation.valid),
    solvable: Boolean(mazeValidation.valid),
    hazardCount: hazards.length,
    hidingSpotCount: hidingSpots.length,
    conflictCount: conflicts.length,
    sameCellConflicts,
    geometryConflicts,
    entranceConflicts,
    dangerZoneConflicts,
    interactionConflicts,
    clearanceConflicts,
    conflicts,
    hazardShortfallTotal,
    hidingShortfallTotal,
    combinedShortfallTotal,
    hazardShortfallsByType,
    hidingShortfallsByType,
    shortfallReasons,
    coexistenceRejections: {
      hazard: hazardReport?.coexistenceRejections ?? 0,
      hiding: hidingReport?.coexistenceRejections ?? 0,
    },
    capacityConstrained: Boolean(capacityPlan?.capacityConstrained),
    insufficientForCombinedMinimums: Boolean(
      capacityPlan?.insufficientForCombinedMinimums
    ),
    hadShortfall: combinedShortfallTotal > 0,
    fullySatisfied:
      conflicts.length === 0 &&
      Boolean(mazeValidation.valid) &&
      hazardSatisfied &&
      hidingSatisfied &&
      combinedShortfallTotal === 0,
  }
}
