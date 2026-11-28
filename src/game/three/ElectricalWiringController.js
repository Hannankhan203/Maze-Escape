import * as THREE from 'three'
import { HAZARD_STATES } from './HazardAgent.js'
import {
  ELECTRICAL_WIRING_CONSTANTS,
  HAZARD_TYPES,
} from '../generation/hazardPlacement.js'
import { hasLineOfSightInMaze, moveWithSubsteps } from '../world/gridCollision.js'
import { hasUnobstructedPropLineOfSight } from '../world/propCollision.js'
import { PLAYER_RADIUS } from '../world/worldCoords.js'
import { updateHazardVisualState } from './buildHazards.js'

export const ELECTRICAL_WIRING_STATES = Object.freeze({
  IDLE: 'idle',
  NEUTRALIZING: 'neutralizing',
  NEUTRALIZED: 'neutralized',
})

export const ELECTRICAL_WIRING_ANIM_MODES = Object.freeze({
  NONE: 'none',
  NEUTRALIZE: 'neutralize',
})

export const ELECTRICAL_WIRING_ANIM_CONFIG = Object.freeze({
  neutralizeDurationSec: 1.95,
  maxReachDistance: 3.05,
  maxActiveBreakoutDistance: 3.65,
  maxPerimeterDetourDistance: 5.5,
  perimeterWalkSpeed: 3.4,
  approachEndProgress: 0.22,
  stanceEndProgress: 0.42,
  completionProgress: 0.78,
  safeClearancePad: 0.04,
  soundEmitRange: 4.0,
})

const _tmpProjVec = new THREE.Vector3()

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function smoothstep01(t) {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function shortestAngleDiff(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current))
}

/**
 * Evaluates a realistic industrial spring-detent breaker lever throw curve (0..1)
 * over Phase C (stanceEndProgress -> completionProgress): heavy initial pull against
 * spring resistance, crisp break over center detent, and solid lock at OFF (+0.52 rad).
 */
function computeBreakerLeverProgress(progress) {
  const start = ELECTRICAL_WIRING_ANIM_CONFIG.stanceEndProgress
  const end = ELECTRICAL_WIRING_ANIM_CONFIG.completionProgress
  if (progress <= start) return 0
  if (progress >= end) return 1
  const u = clamp((progress - start) / Math.max(0.05, end - start), 0, 1)
  if (u < 0.38) {
    // Heavy initial mechanical preload against latch spring
    const k = u / 0.38
    return 0.22 * (k * k)
  }
  if (u < 0.86) {
    // Decisive downward breaker throw past mechanical detent
    const k = (u - 0.38) / 0.48
    return lerp(0.22, 0.98, smoothstep01(k))
  }
  // Final latch seat into OFF stop
  const k = (u - 0.86) / 0.14
  return lerp(0.98, 1.0, smoothstep01(k))
}

function samplePolyline(waypoints, t) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return { x: 0, z: 0 }
  }
  if (waypoints.length === 1) {
    return { x: waypoints[0].x, z: waypoints[0].z }
  }
  const u = clamp(t, 0, 1)
  let totalLen = 0
  for (let i = 1; i < waypoints.length; i += 1) {
    totalLen += Math.hypot(
      waypoints[i].x - waypoints[i - 1].x,
      waypoints[i].z - waypoints[i - 1].z
    )
  }
  if (totalLen <= 1e-6) {
    const last = waypoints[waypoints.length - 1]
    return { x: last.x, z: last.z }
  }
  let targetDist = u * totalLen
  for (let i = 1; i < waypoints.length; i += 1) {
    const a = waypoints[i - 1]
    const b = waypoints[i]
    const segLen = Math.hypot(b.x - a.x, b.z - a.z)
    if (segLen <= 1e-6) continue
    if (targetDist <= segLen || i === waypoints.length - 1) {
      const segT = clamp(targetDist / segLen, 0, 1)
      return {
        x: lerp(a.x, b.x, segT),
        z: lerp(a.z, b.z, segT),
      }
    }
    targetDist -= segLen
  }
  const last = waypoints[waypoints.length - 1]
  return { x: last.x, z: last.z }
}

export class ElectricalWiringController {
  constructor(engine) {
    this.engine = engine || null
    this.isDisposed = false

    this._state = ELECTRICAL_WIRING_STATES.IDLE
    this._stateTimer = 0
    this._activeDurationSec = ELECTRICAL_WIRING_ANIM_CONFIG.neutralizeDurationSec
    this._approachEndProgress = ELECTRICAL_WIRING_ANIM_CONFIG.approachEndProgress
    this._stateProgress = 0
    this._animProgress = 0
    this._leverProgress = 0
    this._neutralizationCommitted = false
    this._activeHazard = null
    this._targetYaw = 0
    this._startYaw = 0
    this._startPos = { x: 0, z: 0 }
    this._targetPos = { x: 0, z: 0 }
    this._approachWaypoints = []
    this._maxRouteAnchorDist = 0
    this._hardwarePos = { x: 0, y: 1.32, z: 0 }
    this._lastInterruptReason = null
  }

  getStateName() {
    return this._state
  }

  isActive() {
    return !this.isDisposed && this._state === ELECTRICAL_WIRING_STATES.NEUTRALIZING
  }

  isNeutralizing() {
    return this.isActive()
  }

  getActiveHazard() {
    return this._activeHazard
  }

  _computeNormalizedAnimProgress(rawProgress) {
    const baseApproach = ELECTRICAL_WIRING_ANIM_CONFIG.approachEndProgress
    const actualApproach = Number.isFinite(this._approachEndProgress)
      ? this._approachEndProgress
      : baseApproach
    const p = clamp(rawProgress, 0, 1)
    if (Math.abs(actualApproach - baseApproach) < 1e-5) {
      return p
    }
    if (p <= actualApproach) {
      return baseApproach * clamp(p / Math.max(0.05, actualApproach), 0, 1)
    }
    const tail = clamp(
      (p - actualApproach) / Math.max(0.05, 1 - actualApproach),
      0,
      1
    )
    return baseApproach + tail * (1 - baseApproach)
  }

  getPhaseName() {
    if (!this.isActive()) return 'idle'
    const p = this._animProgress
    if (p < ELECTRICAL_WIRING_ANIM_CONFIG.approachEndProgress) return 'approach'
    if (p < ELECTRICAL_WIRING_ANIM_CONFIG.stanceEndProgress) return 'stance'
    if (p < ELECTRICAL_WIRING_ANIM_CONFIG.completionProgress) return 'operate'
    return 'withdraw'
  }

  _getHardwarePos(hazard) {
    if (!hazard) return null
    return (
      hazard.breakerWorldPos ||
      hazard.originWorldPos ||
      hazard.getInteractionAnchor?.() ||
      hazard.cellWorldPos ||
      null
    )
  }

  _getMoveRadius() {
    return Number.isFinite(this.engine?.movementConfig?.radius)
      ? Math.max(0, this.engine.movementConfig.radius)
      : PLAYER_RADIUS
  }

  _isPositionSafeFromWiring(hazard, x, z, radius, extraPad = 0) {
    if (!hazard) return false
    if (typeof hazard._isFootprintInElectricalTileArea === 'function') {
      const baseTol = Number.isFinite(hazard.electricalBoundaryTolerance)
        ? hazard.electricalBoundaryTolerance
        : ELECTRICAL_WIRING_CONSTANTS.boundaryTolerance
      return !hazard._isFootprintInElectricalTileArea(
        x,
        z,
        radius,
        baseTol + Math.max(0, extraPad)
      )
    }
    return true
  }

  _hasClearHardwareLOS(fromX, fromZ, hardwarePos, hazard, maze, propColliders) {
    if (!hardwarePos) return false
    if (
      maze?.grid &&
      !hasLineOfSightInMaze(fromX, fromZ, hardwarePos.x, hardwarePos.z, maze)
    ) {
      return false
    }
    if (
      propColliders &&
      !hasUnobstructedPropLineOfSight(
        fromX,
        fromZ,
        hardwarePos.x,
        hardwarePos.z,
        propColliders,
        { ignoreOwnerId: hazard?.id || null }
      )
    ) {
      return false
    }
    return true
  }

  /**
   * Checks whether at least one in-range electrical anchor (breaker or junction origin)
   * has unobstructed line of sight from `(fromX, fromZ)`, matching HazardAgent._resolveInteractionTarget.
   */
  _hasAnyReachableAnchorLOS(fromX, fromZ, hazard, hardwarePos, maze, propColliders) {
    const maxReach = ELECTRICAL_WIRING_ANIM_CONFIG.maxReachDistance
    const distHw = hardwarePos
      ? Math.hypot(fromX - hardwarePos.x, fromZ - hardwarePos.z)
      : Infinity
    const orig = hazard?.originWorldPos || null
    const distOrig = orig
      ? Math.hypot(fromX - orig.x, fromZ - orig.z)
      : Infinity

    if (
      hardwarePos &&
      distHw <= maxReach &&
      this._hasClearHardwareLOS(fromX, fromZ, hardwarePos, hazard, maze, propColliders)
    ) {
      return true
    }
    if (
      orig &&
      orig !== hardwarePos &&
      distOrig <= maxReach &&
      this._hasClearHardwareLOS(fromX, fromZ, orig, hazard, maze, propColliders)
    ) {
      return true
    }
    return false
  }

  /**
   * Checks whether moving smoothly from `playerPos` along `targetWaypoints` (1 or 2
   * segments) with full maze & prop collision stays completely outside the active
   * electrical tile at EVERY intermediate substep, reaches a valid safe working stance
   * within breaker/wiring interaction reach, and preserves unobstructed LOS.
   */
  _evaluateApproachPath(hazard, playerPos, targetWaypoints, hardwarePos, moveRadius) {
    if (!Array.isArray(targetWaypoints) || targetWaypoints.length === 0) {
      return null
    }
    const maze = this.engine?._currentMaze || null
    const propColliders = this.engine?._propCollisionIndex || null
    const extraPad = ELECTRICAL_WIRING_ANIM_CONFIG.safeClearancePad

    const finalTarget = targetWaypoints[targetWaypoints.length - 1]
    if (!this._isPositionSafeFromWiring(hazard, finalTarget.x, finalTarget.z, moveRadius, 0)) {
      return null
    }

    let curX = playerPos.x
    let curZ = playerPos.z
    let totalTravelDist = 0
    let maxAnchorDistAlongRoute = 0
    const origPos = hazard.originWorldPos || hardwarePos
    const verifiedWaypoints = [{ x: curX, z: curZ }]

    const trackAnchorDist = (x, z) => {
      const dHw = Math.hypot(x - hardwarePos.x, z - hardwarePos.z)
      const dOrig = origPos ? Math.hypot(x - origPos.x, z - origPos.z) : Infinity
      const minD = Math.min(dHw, dOrig)
      if (minD > maxAnchorDistAlongRoute) {
        maxAnchorDistAlongRoute = minD
      }
    }
    trackAnchorDist(curX, curZ)

    for (let w = 0; w < targetWaypoints.length; w += 1) {
      const wp = targetWaypoints[w]
      const segDx = wp.x - curX
      const segDz = wp.z - curZ
      const segDist = Math.hypot(segDx, segDz)

      if (segDist > 1e-4) {
        const steps = Math.max(4, Math.ceil(segDist / 0.18))
        const stepDx = segDx / steps
        const stepDz = segDz / steps
        for (let s = 0; s < steps; s += 1) {
          const prevX = curX
          const prevZ = curZ
          if (maze?.grid) {
            const stepped = moveWithSubsteps(
              curX,
              curZ,
              stepDx,
              stepDz,
              maze,
              {
                radius: moveRadius,
                propColliders,
                ignoreOwnerId: hazard.id,
              }
            )
            curX = stepped.x
            curZ = stepped.z
          } else {
            curX += stepDx
            curZ += stepDz
          }
          totalTravelDist += Math.hypot(curX - prevX, curZ - prevZ)
          // Strict full-tile safety guard on every intermediate approach step
          if (!this._isPositionSafeFromWiring(hazard, curX, curZ, moveRadius, 0)) {
            return null
          }
          trackAnchorDist(curX, curZ)
        }
      }

      if (
        w < targetWaypoints.length - 1 &&
        Math.hypot(curX - wp.x, curZ - wp.z) > 0.45
      ) {
        // Intermediate perimeter corner was blocked by a wall or prop
        return null
      }
      verifiedWaypoints.push({ x: curX, z: curZ })
    }

    if (
      targetWaypoints.length > 1 &&
      totalTravelDist > ELECTRICAL_WIRING_ANIM_CONFIG.maxPerimeterDetourDistance
    ) {
      return null
    }

    // Verify final stance retains clean safety margin outside the electrical tile
    const finalSafeWithPad = this._isPositionSafeFromWiring(
      hazard,
      curX,
      curZ,
      moveRadius,
      extraPad * 0.5
    )
    if (!finalSafeWithPad && !this._isPositionSafeFromWiring(hazard, curX, curZ, moveRadius, 0)) {
      return null
    }

    // Must remain within existing electrical hardware interaction reach
    const distBreaker = Math.hypot(curX - hardwarePos.x, curZ - hardwarePos.z)
    const distOrigin = hazard.originWorldPos
      ? Math.hypot(curX - hazard.originWorldPos.x, curZ - hazard.originWorldPos.z)
      : Infinity
    const effectiveReach = Math.min(distBreaker, distOrigin)
    if (effectiveReach > ELECTRICAL_WIRING_ANIM_CONFIG.maxReachDistance) {
      return null
    }

    // Verify clear line of sight to an in-range electrical anchor
    if (
      !this._hasAnyReachableAnchorLOS(
        curX,
        curZ,
        hazard,
        hardwarePos,
        maze,
        propColliders
      )
    ) {
      return null
    }

    return {
      x: curX,
      z: curZ,
      distBreaker,
      travelDist: totalTravelDist,
      maxAnchorDistAlongRoute,
      hasExtraMargin: finalSafeWithPad,
      waypoints: verifiedWaypoints,
      isPerimeterDetour: targetWaypoints.length > 1,
    }
  }

  _evaluateApproachCandidate(hazard, playerPos, candX, candZ, hardwarePos, moveRadius) {
    return this._evaluateApproachPath(
      hazard,
      playerPos,
      [{ x: candX, z: candZ }],
      hardwarePos,
      moveRadius
    )
  }

  _resolveSafeApproachTarget(hazard, playerPos, hardwarePos) {
    const moveRadius = this._getMoveRadius()
    const base = hazard?.cellWorldPos || hazard?.dangerWorldPos
    if (!base || !playerPos || !hardwarePos) return null

    // Character must NEVER begin neutralization from inside the active electrical damage volume
    if (!this._isPositionSafeFromWiring(hazard, playerPos.x, playerPos.z, moveRadius, 0)) {
      return null
    }

    const isCeiling = hazard.mountType === 'ceiling'
    const yaw = isCeiling ? 0 : Number.isFinite(hazard.wallYaw) ? hazard.wallYaw : 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const toWorld = (lx, lz) => ({
      x: base.x + lx * cos + lz * sin,
      z: base.z - lx * sin + lz * cos,
    })

    const dxP = playerPos.x - base.x
    const dzP = playerPos.z - base.z
    const pLocalX = dxP * cos - dzP * sin
    const pLocalZ = dxP * sin + dzP * cos

    const minX = Number.isFinite(hazard.electricalDangerMinLocalX)
      ? hazard.electricalDangerMinLocalX
      : isCeiling
        ? ELECTRICAL_WIRING_CONSTANTS.ceilingDangerMinLocalX
        : ELECTRICAL_WIRING_CONSTANTS.wallDangerMinLocalX
    const maxZ = Number.isFinite(hazard.electricalDangerMaxLocalZ)
      ? hazard.electricalDangerMaxLocalZ
      : isCeiling
        ? ELECTRICAL_WIRING_CONSTANTS.ceilingDangerMaxLocalZ
        : ELECTRICAL_WIRING_CONSTANTS.wallDangerMaxLocalZ
    const tol = Number.isFinite(hazard.electricalBoundaryTolerance)
      ? hazard.electricalBoundaryTolerance
      : ELECTRICAL_WIRING_CONSTANTS.boundaryTolerance
    const safeUpstreamX = minX - moveRadius - tol - ELECTRICAL_WIRING_ANIM_CONFIG.safeClearancePad
    const safeOppositeZ = maxZ + moveRadius + tol + ELECTRICAL_WIRING_ANIM_CONFIG.safeClearancePad

    const localCandidates = isCeiling
      ? [
          { lx: safeUpstreamX, lz: 0.0 },
          { lx: safeUpstreamX, lz: -0.4 },
          { lx: safeUpstreamX, lz: 0.4 },
          { lx: safeUpstreamX - 0.12, lz: 0.0 },
          { lx: safeUpstreamX, lz: -0.78 },
          { lx: safeUpstreamX, lz: 0.78 },
        ]
      : [
          { lx: safeUpstreamX, lz: -1.22 },
          { lx: safeUpstreamX - 0.04, lz: -1.12 },
          { lx: safeUpstreamX, lz: -0.96 },
          { lx: safeUpstreamX - 0.1, lz: -1.22 },
          { lx: safeUpstreamX, lz: -0.76 },
          { lx: safeUpstreamX - 0.16, lz: -1.16 },
        ]

    const worldCandidates = localCandidates.map((pt) => toWorld(pt.lx, pt.lz))
    // Also evaluate the player's current safe position as an alternative if preferred spots are blocked
    worldCandidates.push({ x: playerPos.x, z: playerPos.z })

    const canTryPerimeterDetour =
      !isCeiling && pLocalZ >= maxZ + moveRadius + tol - 0.05 && pLocalX > safeUpstreamX
    const cornerWorld = canTryPerimeterDetour
      ? toWorld(safeUpstreamX, Math.max(pLocalZ, safeOppositeZ))
      : null

    let best = null
    let bestScore = -Infinity

    for (let i = 0; i < worldCandidates.length; i += 1) {
      const cand = worldCandidates[i]
      const isCurrentFallback = i === worldCandidates.length - 1

      let evaluated = this._evaluateApproachPath(
        hazard,
        playerPos,
        [cand],
        hardwarePos,
        moveRadius
      )

      // When standing safely in the opposite corridor lane, straight-line movement toward
      // the upstream breaker cuts across the electrified tile corner; route cleanly around
      // the outside perimeter corner `(safeUpstreamX, safeOppositeZ)` instead.
      if (!evaluated && !isCurrentFallback && cornerWorld) {
        evaluated = this._evaluateApproachPath(
          hazard,
          playerPos,
          [cornerWorld, cand],
          hardwarePos,
          moveRadius
        )
      }

      if (!evaluated) continue

      // Prefer close, collision-free upstream working stances cleanly aligned with the breaker
      const score =
        100 -
        evaluated.distBreaker * 8 -
        evaluated.travelDist * (evaluated.isPerimeterDetour ? 2.2 : 4) +
        (evaluated.hasExtraMargin ? 6 : 0) -
        (isCurrentFallback ? 12 : i * 0.6)

      if (score > bestScore) {
        bestScore = score
        best = {
          x: evaluated.x,
          z: evaluated.z,
          waypoints: evaluated.waypoints,
          travelDist: evaluated.travelDist,
          maxAnchorDistAlongRoute: evaluated.maxAnchorDistAlongRoute,
        }
      }
    }

    return best
  }

  _getPlayerFacingYaw() {
    return (
      this.engine?._playerGroup?.rotation?.y ??
      this.engine?.cameraRig?.getCharacterDirection?.()?.yaw ??
      this.engine?.cameraRig?.getLookDirection?.()?.yaw ??
      0
    )
  }

  _findReachableElectricalHazard(playerPosOverride = null) {
    const hazards = this.engine?.hazardManager?.getHazards?.()
    if (!Array.isArray(hazards) || hazards.length === 0) return null
    const playerPos = playerPosOverride || this.engine?._playerWorldPos
    if (!playerPos) return null

    let bestHaz = null
    let bestDist = Infinity
    for (let i = 0; i < hazards.length; i += 1) {
      const h = hazards[i]
      if (
        h &&
        h.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING &&
        !h.isDisposed &&
        h.state === HAZARD_STATES.ACTIVE &&
        !h.isAftermathCleared
      ) {
        const hw = this._getHardwarePos(h)
        const orig = h.originWorldPos || hw
        const dHw = hw ? Math.hypot(playerPos.x - hw.x, playerPos.z - hw.z) : Infinity
        const dOrig = orig ? Math.hypot(playerPos.x - orig.x, playerPos.z - orig.z) : Infinity
        const d = Math.min(dHw, dOrig)
        if (d <= ELECTRICAL_WIRING_ANIM_CONFIG.maxReachDistance && d < bestDist) {
          bestDist = d
          bestHaz = h
        }
      }
    }
    return bestHaz
  }

  /**
   * Single source of truth for whether electrical wiring neutralization can start right now.
   * Consulted by BOTH `HazardAgent.canPlayerInteract` (prompt visibility) and
   * `tryStartNeutralize` (click dispatch) so prompts and clicks can never diverge.
   */
  _evaluateStartEligibility(hazard = null, options = null) {
    if (
      this.isDisposed ||
      !this.engine ||
      this.engine.isGameOver ||
      this.engine.hasWon ||
      this.engine.isPaused
    ) {
      return { ok: false, reason: 'unavailable' }
    }
    if (this._state === ELECTRICAL_WIRING_STATES.NEUTRALIZING) {
      return { ok: false, reason: 'already_active' }
    }
    if (this.engine.hidingSpotManager?.isPlayerHiding?.()) {
      return { ok: false, reason: 'hiding' }
    }
    if (
      this.engine.rubbleController?.isActive?.() ||
      this.engine.furnitureController?.isActive?.() ||
      this.engine.pipesController?.isActive?.() ||
      this.engine.steamRepairController?.isActive?.()
    ) {
      return { ok: false, reason: 'busy_other_controller' }
    }

    const playerPos = options?.playerWorldPos || this.engine._playerWorldPos
    const activeHaz = hazard || this._findReachableElectricalHazard(playerPos)
    if (!activeHaz) {
      return { ok: false, reason: 'no_target' }
    }
    if (
      activeHaz.type !== HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING ||
      activeHaz.isDisposed ||
      activeHaz.state !== HAZARD_STATES.ACTIVE ||
      activeHaz.isAftermathCleared
    ) {
      return { ok: false, reason: 'invalid_target' }
    }

    const hardwarePos = this._getHardwarePos(activeHaz)
    if (!playerPos || !hardwarePos) {
      return { ok: false, reason: 'missing_context' }
    }

    const distHw = Math.hypot(playerPos.x - hardwarePos.x, playerPos.z - hardwarePos.z)
    const distOrig = activeHaz.originWorldPos
      ? Math.hypot(
          playerPos.x - activeHaz.originWorldPos.x,
          playerPos.z - activeHaz.originWorldPos.z
        )
      : Infinity
    if (Math.min(distHw, distOrig) > ELECTRICAL_WIRING_ANIM_CONFIG.maxReachDistance) {
      return { ok: false, reason: 'out_of_range' }
    }

    const maze = this.engine._currentMaze || null
    const propColliders = this.engine._propCollisionIndex || null
    if (
      !this._hasAnyReachableAnchorLOS(
        playerPos.x,
        playerPos.z,
        activeHaz,
        hardwarePos,
        maze,
        propColliders
      )
    ) {
      return { ok: false, reason: 'obstructed' }
    }

    const moveRadius = this._getMoveRadius()
    if (!this._isPositionSafeFromWiring(activeHaz, playerPos.x, playerPos.z, moveRadius, 0)) {
      return { ok: false, reason: 'player_in_danger_zone' }
    }

    const approachPlan = this._resolveSafeApproachTarget(activeHaz, playerPos, hardwarePos)
    if (!approachPlan) {
      return { ok: false, reason: 'unsafe_position' }
    }

    return {
      ok: true,
      reason: null,
      hazard: activeHaz,
      playerPos,
      hardwarePos,
      approachPlan,
    }
  }

  canStartNeutralize(hazard = null, options = null) {
    return this._evaluateStartEligibility(hazard, options).ok
  }

  /**
   * Used by unlocked-mouse `pointerdown` handling so clicking on/near targeted active
   * electrical wiring dispatches immediately (preventing >6px jitter from turning clicks
   * into drag-look) without interfering with unrelated drag-look turns.
   */
  canQuickStart(ndc = null) {
    const evalRes = this._evaluateStartEligibility(null)
    if (!evalRes.ok) return false

    const camera = this.engine?.cameraRig?.camera
    if (!camera || !ndc || !Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) {
      return true
    }

    camera.updateMatrixWorld?.(true)
    const anchors = [evalRes.hardwarePos]
    if (evalRes.hazard?.originWorldPos) anchors.push(evalRes.hazard.originWorldPos)
    if (evalRes.hazard?.dangerWorldPos) anchors.push(evalRes.hazard.dangerWorldPos)

    for (let i = 0; i < anchors.length; i += 1) {
      const a = anchors[i]
      if (!a) continue
      _tmpProjVec.set(
        a.x,
        Number.isFinite(a.y) ? a.y : 1.25,
        a.z
      )
      _tmpProjVec.project(camera)
      if (_tmpProjVec.z >= -1 && _tmpProjVec.z <= 1) {
        const distToClick = Math.hypot(_tmpProjVec.x - ndc.x, _tmpProjVec.y - ndc.y)
        const distToCenter = Math.hypot(_tmpProjVec.x, _tmpProjVec.y)
        if (distToClick <= 0.55 || distToCenter <= 0.45) {
          return true
        }
      }
    }
    return false
  }

  tryStartNeutralize(hazard = null) {
    const evalRes = this._evaluateStartEligibility(hazard)
    if (!evalRes.ok) {
      return { handled: false, reason: evalRes.reason }
    }

    const { hazard: activeHaz, playerPos, hardwarePos, approachPlan } = evalRes

    this._activeHazard = activeHaz
    this._state = ELECTRICAL_WIRING_STATES.NEUTRALIZING
    this._stateTimer = 0
    this._stateProgress = 0
    this._animProgress = 0
    this._leverProgress = 0
    this._neutralizationCommitted = false
    this._lastInterruptReason = null

    const baseDur = ELECTRICAL_WIRING_ANIM_CONFIG.neutralizeDurationSec
    const baseApproachEnd = ELECTRICAL_WIRING_ANIM_CONFIG.approachEndProgress
    const travelDist = approachPlan.travelDist || 0
    if (travelDist > 1.25) {
      const extraApproachSec = clamp(
        (travelDist - 1.25) / ELECTRICAL_WIRING_ANIM_CONFIG.perimeterWalkSpeed,
        0,
        1.35
      )
      const baseApproachSec = baseDur * baseApproachEnd
      const postApproachSec = baseDur * (1 - baseApproachEnd)
      this._activeDurationSec = baseApproachSec + extraApproachSec + postApproachSec
      this._approachEndProgress = (baseApproachSec + extraApproachSec) / this._activeDurationSec
    } else {
      this._activeDurationSec = baseDur
      this._approachEndProgress = baseApproachEnd
    }

    this._startPos = { x: playerPos.x, z: playerPos.z }
    this._targetPos = { x: approachPlan.x, z: approachPlan.z }
    this._approachWaypoints = Array.isArray(approachPlan.waypoints)
      ? approachPlan.waypoints.map((pt) => ({ x: pt.x, z: pt.z }))
      : [
          { x: playerPos.x, z: playerPos.z },
          { x: approachPlan.x, z: approachPlan.z },
        ]
    this._maxRouteAnchorDist = Number.isFinite(approachPlan.maxAnchorDistAlongRoute)
      ? approachPlan.maxAnchorDistAlongRoute
      : 0
    this._hardwarePos = {
      x: hardwarePos.x,
      y: Number.isFinite(hardwarePos.y) ? hardwarePos.y : 1.32,
      z: hardwarePos.z,
    }

    const curYaw = this._getPlayerFacingYaw()
    this._startYaw = curYaw
    const dx = hardwarePos.x - this._targetPos.x
    const dz = hardwarePos.z - this._targetPos.z
    if (dx * dx + dz * dz > 1e-4) {
      this._targetYaw = Math.atan2(-dx, -dz)
    } else {
      const fdx = hardwarePos.x - playerPos.x
      const fdz = hardwarePos.z - playerPos.z
      this._targetYaw =
        fdx * fdx + fdz * fdz > 1e-4 ? Math.atan2(-fdx, -fdz) : curYaw
    }

    activeHaz.setBreakerLeverProgress?.(0)
    this.engine.syncPlayerVisibility?.()
    this.engine._notifyStealthChange?.(true)

    return {
      handled: true,
      action: 'insulate_wiring',
      hazardId: activeHaz.id,
      state: this._state,
      phase: this.getPhaseName(),
      targetPos: { ...this._targetPos },
    }
  }

  _commitNeutralization(hazard) {
    if (!hazard || this._neutralizationCommitted) return false
    this._neutralizationCommitted = true
    this._leverProgress = 1

    hazard.state = HAZARD_STATES.DISABLED
    hazard.isDisabled = true
    hazard.isPermanentlyCollapsed = true
    hazard.isAftermathCleared = true
    hazard.timer = 0
    hazard.lastMovementEffect = null
    hazard.setBreakerLeverProgress?.(1)
    hazard._syncColliderStates?.(1)

    if (hazard.mesh?.userData) {
      const data = hazard.mesh.userData
      data.isAftermathCleared = true
      data.isPermanentlyCollapsed = true
      data.breakerLeverProgress = 1
      if (data.breakerHandleGroup) {
        data.breakerHandleGroup.rotation.x = 0.52
      }
      if (data.junctionDoorGroup) {
        data.junctionDoorGroup.rotation.y = 0
      }
      if (data.arcGroup) data.arcGroup.visible = false
      if (data.sparkGroup) data.sparkGroup.visible = false
      if (data.glowMesh) data.glowMesh.visible = false
      if (data.insulationGroup) data.insulationGroup.visible = true
    }
    updateHazardVisualState(hazard.mesh, HAZARD_STATES.DISABLED, 1)

    const soundAnchor = this._getHardwarePos(hazard) || this._hardwarePos
    this.engine?.audioEngine?.onHazardInteraction?.(
      'insulate_wiring',
      hazard.type,
      soundAnchor
    )
    this.engine?.emitSound?.(
      soundAnchor,
      ELECTRICAL_WIRING_ANIM_CONFIG.soundEmitRange,
      0.5
    )
    this.engine?._syncHazardColliders?.({ allowPushOut: false })
    this.engine?._notifyStealthChange?.(true)
    return true
  }

  interruptNeutralize(options = null) {
    if (this._state !== ELECTRICAL_WIRING_STATES.NEUTRALIZING) {
      return false
    }
    const reason = options?.reason || 'interrupted'
    const hazard = this._activeHazard
    this._lastInterruptReason = reason

    // Electrical isolation is atomic: if interrupted before the breaker throws OFF,
    // spring the lever back to ON and keep the hazard live & active (never falsely neutralized).
    if (hazard && !this._neutralizationCommitted && !hazard.isDisposed) {
      hazard.setBreakerLeverProgress?.(0)
      if (hazard.state === HAZARD_STATES.ACTIVE && hazard.mesh) {
        updateHazardVisualState(hazard.mesh, HAZARD_STATES.ACTIVE, Math.max(0.01, hazard.timer))
      }
    }

    this._activeHazard = null
    this._state = this._neutralizationCommitted
      ? ELECTRICAL_WIRING_STATES.NEUTRALIZED
      : ELECTRICAL_WIRING_STATES.IDLE
    this._stateTimer = 0
    this._stateProgress = this._neutralizationCommitted ? 1 : 0
    this._animProgress = this._neutralizationCommitted ? 1 : 0
    this._leverProgress = this._neutralizationCommitted ? 1 : 0
    this._neutralizationCommitted = false
    this._approachWaypoints = []
    this._maxRouteAnchorDist = 0

    this.engine?.syncPlayerVisibility?.()
    this.engine?._notifyStealthChange?.(true)
    return true
  }

  onMovementInput(hasMovementInput) {
    if (!hasMovementInput || this.isDisposed) return false
    if (this._state === ELECTRICAL_WIRING_STATES.NEUTRALIZING) {
      this.interruptNeutralize({ immediate: true, reason: 'movement' })
      return true
    }
    return false
  }

  update(delta = 0) {
    if (
      this.isDisposed ||
      !this.engine ||
      this._state !== ELECTRICAL_WIRING_STATES.NEUTRALIZING
    ) {
      return
    }
    if (this.engine.isGameOver || this.engine.hasWon || this.engine.isPaused) {
      this.interruptNeutralize({
        immediate: true,
        reason: this.engine.isGameOver
          ? 'game_over'
          : this.engine.isPaused
            ? 'paused'
            : 'ended',
      })
      return
    }

    const dt = Number.isFinite(delta) && delta > 0 ? delta : 0
    const hazard = this._activeHazard
    const playerPos = this.engine._playerWorldPos
    const hardwarePos = this._getHardwarePos(hazard)
    if (!hazard || hazard.isDisposed || !playerPos || !hardwarePos) {
      this.interruptNeutralize({ immediate: true, reason: 'invalid_state' })
      return
    }

    if (
      !this._neutralizationCommitted &&
      (hazard.state !== HAZARD_STATES.ACTIVE || hazard.isAftermathCleared)
    ) {
      this.interruptNeutralize({ immediate: true, reason: 'hazard_state_changed' })
      return
    }

    const distHw = Math.hypot(playerPos.x - hardwarePos.x, playerPos.z - hardwarePos.z)
    const distOrig = hazard.originWorldPos
      ? Math.hypot(
          playerPos.x - hazard.originWorldPos.x,
          playerPos.z - hazard.originWorldPos.z
        )
      : Infinity
    const maxBreakout = Math.max(
      ELECTRICAL_WIRING_ANIM_CONFIG.maxActiveBreakoutDistance,
      this._maxRouteAnchorDist + 0.55
    )
    if (Math.min(distHw, distOrig) > maxBreakout) {
      this.interruptNeutralize({ immediate: true, reason: 'out_of_range' })
      return
    }

    const moveRadius = this._getMoveRadius()
    // Continuous safety enforcement: if player was pushed into active danger zone, abort cleanly
    if (
      !this._neutralizationCommitted &&
      !this._isPositionSafeFromWiring(hazard, playerPos.x, playerPos.z, moveRadius, 0)
    ) {
      this.interruptNeutralize({ immediate: true, reason: 'entered_danger_zone' })
      return
    }

    this._stateTimer += dt
    const dur = Math.max(0.4, this._activeDurationSec)
    this._stateProgress = clamp(this._stateTimer / dur, 0, 1)
    this._animProgress = this._computeNormalizedAnimProgress(this._stateProgress)

    // Phase A: Smooth collision-aware approach along validated safe waypoint route
    const approachEnd = this._approachEndProgress || ELECTRICAL_WIRING_ANIM_CONFIG.approachEndProgress
    const posT = smoothstep01(this._stateProgress / Math.max(0.05, approachEnd))
    const desired =
      this._approachWaypoints.length >= 2
        ? samplePolyline(this._approachWaypoints, posT)
        : {
            x: lerp(this._startPos.x, this._targetPos.x, posT),
            z: lerp(this._startPos.z, this._targetPos.z, posT),
          }

    if (
      this._stateProgress <= approachEnd + 0.08 &&
      Math.hypot(desired.x - playerPos.x, desired.z - playerPos.z) > 1e-5
    ) {
      let nextX = desired.x
      let nextZ = desired.z
      if (this.engine._currentMaze?.grid) {
        const stepped = moveWithSubsteps(
          playerPos.x,
          playerPos.z,
          desired.x - playerPos.x,
          desired.z - playerPos.z,
          this.engine._currentMaze,
          {
            radius: moveRadius,
            propColliders: this.engine._propCollisionIndex || null,
            ignoreOwnerId: hazard.id,
          }
        )
        nextX = stepped.x
        nextZ = stepped.z
      }
      // Hard runtime guard: never step into the active electrical tile during approach
      if (
        this._neutralizationCommitted ||
        this._isPositionSafeFromWiring(hazard, nextX, nextZ, moveRadius, 0)
      ) {
        playerPos.x = nextX
        playerPos.z = nextZ
        if (this.engine._playerGroup?.position) {
          this.engine._playerGroup.position.x = nextX
          this.engine._playerGroup.position.z = nextZ
        }
        this.engine.cameraRig?.setPlayerPosition?.(
          nextX,
          playerPos.y || 0,
          nextZ
        )
      }
    }

    // Smooth body orientation toward the breaker switch
    const turnT = smoothstep01(this._animProgress / 0.28)
    const yawDiff = shortestAngleDiff(this._targetYaw, this._startYaw)
    const nextYaw = this._startYaw + yawDiff * turnT
    if (this.engine._playerGroup?.rotation) {
      this.engine._playerGroup.rotation.y = nextYaw
    }
    if (this._animProgress <= 0.34 || this.engine.cameraRig?.isFreeLookActive?.()) {
      this.engine.cameraRig?.setCharacterYaw?.(nextYaw)
    }

    // Phase C: Visually animate the actual existing isolation breaker handle
    if (!this._neutralizationCommitted) {
      this._leverProgress = computeBreakerLeverProgress(this._animProgress)
      hazard.setBreakerLeverProgress?.(this._leverProgress)
    }

    // Phase D: Atomic neutralization completion right when breaker reaches OFF detent
    if (
      !this._neutralizationCommitted &&
      this._animProgress >= ELECTRICAL_WIRING_ANIM_CONFIG.completionProgress
    ) {
      this._commitNeutralization(hazard)
    }

    // Phase E: Withdrawal completes cleanly back to normal locomotion/idle
    if (this._stateProgress >= 1) {
      this._state = ELECTRICAL_WIRING_STATES.NEUTRALIZED
      this._activeHazard = null
      this._stateTimer = 0
      this._stateProgress = 1
      this._animProgress = 1
      this._leverProgress = 1
      this._neutralizationCommitted = false
      this._approachWaypoints = []
      this._maxRouteAnchorDist = 0
      this.engine.syncPlayerVisibility?.()
      this.engine._notifyStealthChange?.(true)
    }
  }

  getAnimatorPayload() {
    if (
      this.isDisposed ||
      this._state !== ELECTRICAL_WIRING_STATES.NEUTRALIZING
    ) {
      return {
        mode: ELECTRICAL_WIRING_ANIM_MODES.NONE,
        progress: 0,
        leverProgress: 0,
        phase: 'idle',
      }
    }
    return {
      mode: ELECTRICAL_WIRING_ANIM_MODES.NEUTRALIZE,
      progress: this._animProgress,
      leverProgress: this._leverProgress,
      phase: this.getPhaseName(),
    }
  }

  getInteractionSnapshot() {
    const reachableHaz = this._findReachableElectricalHazard()
    return {
      state: this._state,
      phase: this.getPhaseName(),
      isNeutralizing: this.isNeutralizing(),
      activeHazardId: this._activeHazard ? this._activeHazard.id : null,
      reachableHazardId: reachableHaz ? reachableHaz.id : null,
      progress: Math.round(this._animProgress * 100) / 100,
      leverProgress: Math.round(this._leverProgress * 100) / 100,
      neutralizationCommitted: Boolean(this._neutralizationCommitted),
      lastInterruptReason: this._lastInterruptReason,
    }
  }

  reset() {
    if (
      this._activeHazard &&
      !this._neutralizationCommitted &&
      !this._activeHazard.isDisposed
    ) {
      this._activeHazard.setBreakerLeverProgress?.(0)
    }
    this._activeHazard = null
    this._state = ELECTRICAL_WIRING_STATES.IDLE
    this._stateTimer = 0
    this._activeDurationSec = ELECTRICAL_WIRING_ANIM_CONFIG.neutralizeDurationSec
    this._approachEndProgress = ELECTRICAL_WIRING_ANIM_CONFIG.approachEndProgress
    this._stateProgress = 0
    this._animProgress = 0
    this._leverProgress = 0
    this._neutralizationCommitted = false
    this._startPos = { x: 0, z: 0 }
    this._targetPos = { x: 0, z: 0 }
    this._approachWaypoints = []
    this._maxRouteAnchorDist = 0
    this._hardwarePos = { x: 0, y: 1.32, z: 0 }
    this._lastInterruptReason = null
    this.engine?.syncPlayerVisibility?.()
  }

  dispose() {
    if (this.isDisposed) return
    this.isDisposed = true
    this.reset()
    this.engine = null
  }
}
