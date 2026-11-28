import * as THREE from 'three'
import { HAZARD_STATES } from './HazardAgent.js'
import {
  FLOOR_GRATE_CONSTANTS,
  HAZARD_TYPES,
} from '../generation/hazardPlacement.js'
import { hasLineOfSightInMaze, moveWithSubsteps } from '../world/gridCollision.js'
import { hasUnobstructedPropLineOfSight } from '../world/propCollision.js'
import { PLAYER_RADIUS } from '../world/worldCoords.js'

export const FLOOR_GRATE_STATES = Object.freeze({
  IDLE: 'idle',
  SECURING: 'securing',
  SECURED: 'secured',
})

export const FLOOR_GRATE_ANIM_MODES = Object.freeze({
  NONE: 'none',
  SECURE: 'secure',
})

export const FLOOR_GRATE_ANIM_CONFIG = Object.freeze({
  secureDurationSec: 2.15,
  maxReachDistance: 2.2,
  maxActiveBreakoutDistance: 2.75,
  approachEndProgress: 0.2,
  crouchEndProgress: 0.38,
  seatEndProgress: 0.62,
  completionProgress: 0.8,
  releaseEndProgress: 0.89,
  safeEdgePad: 0.08,
  safeClearancePad: 0.01,
  soundEmitRange: 4.5,
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
 * Maps overall floor-grate securing progress (0..1) into the physical trench-cover
 * placement & perimeter bolt-seating progress (0..1) over Phase C:
 *   - 0.00..0.55 (overall crouchEndProgress..seatEndProgress): lower & slide existing
 *     `securedCoverGroup` from the player's safe working edge onto the flush curb frame.
 *   - 0.55..1.00 (overall seatEndProgress..completionProgress): seat the 6 existing
 *     perimeter anchor bolts into the curb flange.
 */
function computeCoverSecureProgress(progress) {
  const start = FLOOR_GRATE_ANIM_CONFIG.crouchEndProgress
  const seatEnd = FLOOR_GRATE_ANIM_CONFIG.seatEndProgress
  const end = FLOOR_GRATE_ANIM_CONFIG.completionProgress
  if (progress <= start) return 0
  if (progress >= end) return 1
  if (progress <= seatEnd) {
    const u = clamp((progress - start) / Math.max(0.05, seatEnd - start), 0, 1)
    return 0.55 * smoothstep01(u)
  }
  const u = clamp((progress - seatEnd) / Math.max(0.05, end - seatEnd), 0, 1)
  return lerp(0.55, 1.0, smoothstep01(u))
}

/**
 * Physical Collapsing Floor Grate Neutralization Animation Controller
 * (MAZE-HAZARD-GRATE-ANIM-001)
 *
 * Orchestrates the multi-phase physical securing of a collapsed `COLLAPSING_FLOOR_GRATE`
 * pit opening using the existing bolted steel trench recovery cover (`securedCoverGroup`)
 * and perimeter anchor bolts without altering hazard collapse triggers, damage, placement,
 * or aftermath collision geometry:
 *   1. APPROACH (0.00..0.20): Collision-aware step to a safe working edge outside the open
 *      pit collider while turning smoothly to face the opening.
 *   2. WORKING POSITION (0.20..0.38): Grounded asymmetric crouch/kneel at the curb rim.
 *   3. SECURING ACTION (0.38..0.80):
 *      - C1 (0.38..0.62): Two-handed lowering and sliding of the steel recovery cover onto
 *        the perimeter steel curb.
 *      - C2 (0.62..0.80): Alternating left/right downward presses seating the perimeter
 *        anchor bolts firmly into the curb.
 *   4. COMMIT (>= 0.80): Atomic neutralization — locks the cover flush, disables the
 *      aftermath pit collider (`clearAftermath()`), emits the single existing
 *      `secure_floor_opening` audio/subtitle cue, and notifies stealth/UI state.
 *   5. RELEASE & WITHDRAW (0.80..1.00): Releases hands and rises smoothly back to standing.
 */
export class FloorGrateController {
  constructor(engine) {
    this.engine = engine || null
    this.isDisposed = false

    this._state = FLOOR_GRATE_STATES.IDLE
    this._activeHazard = null
    this._elapsed = 0
    this._duration = FLOOR_GRATE_ANIM_CONFIG.secureDurationSec
    this._progress = 0
    this._securingCommitted = false

    this._startPos = { x: 0, z: 0 }
    this._approachPos = { x: 0, z: 0 }
    this._approachLocalDir = { lx: 0, lz: 1 }
    this._needsApproach = false
    this._targetYaw = 0
    this._startYaw = 0

    // Reusable animator payload (zero per-frame allocations)
    this._animatorPayload = {
      mode: FLOOR_GRATE_ANIM_MODES.NONE,
      progress: 0,
      phase: 'idle',
      isFirstPerson: false,
      active: false,
    }
  }

  getStateName() {
    return this._state
  }

  isSecuring() {
    return this._state === FLOOR_GRATE_STATES.SECURING
  }

  isActive() {
    return this._state === FLOOR_GRATE_STATES.SECURING
  }

  getActiveHazard() {
    return this._activeHazard
  }

  getProgress() {
    return this._progress
  }

  getInteractionSnapshot() {
    return {
      state: this._state,
      isSecuring: this._state === FLOOR_GRATE_STATES.SECURING,
      activeHazardId: this._activeHazard?.id || null,
      progress: this._progress,
      committed: this._securingCommitted,
    }
  }

  getAnimatorPayload() {
    if (this._state !== FLOOR_GRATE_STATES.SECURING || !this._activeHazard) {
      return null
    }
    const p = this._progress
    let phase = 'withdraw'
    if (p < FLOOR_GRATE_ANIM_CONFIG.approachEndProgress) {
      phase = 'approach'
    } else if (p < FLOOR_GRATE_ANIM_CONFIG.crouchEndProgress) {
      phase = 'crouch'
    } else if (p < FLOOR_GRATE_ANIM_CONFIG.seatEndProgress) {
      phase = 'seat_cover'
    } else if (p < FLOOR_GRATE_ANIM_CONFIG.completionProgress) {
      phase = 'bolt_cover'
    } else if (p < FLOOR_GRATE_ANIM_CONFIG.releaseEndProgress) {
      phase = 'release'
    }
    this._animatorPayload.mode = FLOOR_GRATE_ANIM_MODES.SECURE
    this._animatorPayload.progress = p
    this._animatorPayload.phase = phase
    this._animatorPayload.isFirstPerson =
      this.engine?.cameraRig?.getMode?.() === 'first_person'
    this._animatorPayload.active = true
    return this._animatorPayload
  }

  _getGrateCenter(hazard) {
    if (!hazard) return null
    if (hazard.dangerWorldPos) return hazard.dangerWorldPos
    if (typeof hazard.getInteractionAnchor === 'function') {
      return hazard.getInteractionAnchor()
    }
    return hazard.worldPos || hazard.cellWorldPos || null
  }

  _getMoveRadius() {
    return Number.isFinite(this.engine?.movementConfig?.radius)
      ? this.engine.movementConfig.radius
      : PLAYER_RADIUS
  }

  /**
   * Returns true only when `(x, z)` with circular player collision footprint `radius` stays
   * strictly outside the open collapsing floor grate pit opening (exact circle-vs-OBB check).
   */
  _isPositionSafeFromGrate(
    hazard,
    x,
    z,
    radius = PLAYER_RADIUS,
    extraPad = FLOOR_GRATE_ANIM_CONFIG.safeClearancePad
  ) {
    if (!hazard || !Number.isFinite(x) || !Number.isFinite(z)) return false
    const center = this._getGrateCenter(hazard)
    if (!center) return false
    const yaw = Number.isFinite(hazard.grateYaw) ? hazard.grateYaw : 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const dx = x - center.x
    const dz = z - center.z
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    const hw = hazard.pitInnerHalfW ?? FLOOR_GRATE_CONSTANTS.pitInnerHalfW
    const hd = hazard.pitInnerHalfD ?? FLOOR_GRATE_CONSTANTS.pitInnerHalfD
    const clampedX = clamp(lx, -hw, hw)
    const clampedZ = clamp(lz, -hd, hd)
    const distToPit = Math.hypot(lx - clampedX, lz - clampedZ)
    const minClearance = Math.max(0, Number(radius) || 0) + Math.max(0, Number(extraPad) || 0)
    return distToPit > minClearance
  }

  _hasClearSightToGrate(fromX, fromZ, grateCenter, maze, propColliders, hazardId) {
    if (!grateCenter) return false
    if (maze && !hasLineOfSightInMaze(fromX, fromZ, grateCenter.x, grateCenter.z, maze)) {
      return false
    }
    if (
      propColliders &&
      !hasUnobstructedPropLineOfSight(
        fromX,
        fromZ,
        grateCenter.x,
        grateCenter.z,
        propColliders,
        {
          ignoreOwnerId: hazardId,
          ignoreTraversable: true,
        }
      )
    ) {
      return false
    }
    return true
  }

  /**
   * Evaluates a collision-checked straight movement from `playerPos` to `targetPos`.
   * IMPORTANT: Intentionally does NOT ignore `hazard.id` in `moveWithSubsteps`, so the
   * open pit's own aftermath OBB collider physically blocks any approach path that tries
   * to cross through the collapsed opening.
   */
  _evaluateApproachCandidate(hazard, playerPos, targetPos, grateCenter, moveRadius) {
    const maze = this.engine?._currentMaze
    const propColliders = this.engine?._propCollisionIndex || null
    if (!maze || !playerPos || !targetPos || !grateCenter) return null

    const moveDist = Math.hypot(targetPos.x - playerPos.x, targetPos.z - playerPos.z)
    let curX = playerPos.x
    let curZ = playerPos.z

    if (moveDist > 0.02) {
      const steps = Math.max(2, Math.min(10, Math.ceil(moveDist / 0.2)))
      for (let s = 1; s <= steps; s += 1) {
        const nextX = lerp(playerPos.x, targetPos.x, s / steps)
        const nextZ = lerp(playerPos.z, targetPos.z, s / steps)
        const res = moveWithSubsteps(curX, curZ, nextX - curX, nextZ - curZ, maze, {
          radius: moveRadius,
          propColliders,
          allowStepOver: true,
        })
        curX = res.x
        curZ = res.z
        if (!this._isPositionSafeFromGrate(hazard, curX, curZ, moveRadius)) {
          return null
        }
      }
      // Reject candidates where walls, props, or the open pit collider deflected us far off target
      if (Math.hypot(curX - targetPos.x, curZ - targetPos.z) > 0.34) {
        return null
      }
    } else if (!this._isPositionSafeFromGrate(hazard, curX, curZ, moveRadius)) {
      return null
    }

    const distCenter = Math.hypot(curX - grateCenter.x, curZ - grateCenter.z)
    if (distCenter > FLOOR_GRATE_ANIM_CONFIG.maxReachDistance + 0.06) {
      return null
    }
    if (distCenter < 0.55) {
      return null
    }

    if (!this._hasClearSightToGrate(curX, curZ, grateCenter, maze, propColliders, hazard.id)) {
      return null
    }

    return {
      x: curX,
      z: curZ,
      distCenter,
      moveDist: Math.hypot(curX - playerPos.x, curZ - playerPos.z),
    }
  }

  /**
   * Computes a collision-safe, pit-clear working edge around the collapsed floor grate.
   * Evaluates all 4 cardinal curb rims (plus slight lateral offsets along each rim) and
   * the player's current safe stance, returning `null` if no safe stance can be reached.
   */
  _resolveSafeApproachTarget(hazard, playerPos) {
    const grateCenter = this._getGrateCenter(hazard)
    const maze = this.engine?._currentMaze
    if (!hazard || !playerPos || !grateCenter || !maze) {
      return null
    }

    const moveRadius = this._getMoveRadius()
    const yaw = Number.isFinite(hazard.grateYaw) ? hazard.grateYaw : 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)

    const toWorld = (lx, lz) => ({
      x: grateCenter.x + lx * cos + lz * sin,
      z: grateCenter.z - lx * sin + lz * cos,
    })

    const halfW = Math.max(
      hazard.aftermathHalfW ?? FLOOR_GRATE_CONSTANTS.colliderHalfW,
      hazard.pitInnerHalfW ?? FLOOR_GRATE_CONSTANTS.pitInnerHalfW
    )
    const halfD = Math.max(
      hazard.aftermathHalfD ?? FLOOR_GRATE_CONSTANTS.colliderHalfD,
      hazard.pitInnerHalfD ?? FLOOR_GRATE_CONSTANTS.pitInnerHalfD
    )
    const edgePad = FLOOR_GRATE_ANIM_CONFIG.safeEdgePad
    const edgeX = halfW + moveRadius + edgePad
    const edgeZ = halfD + moveRadius + edgePad

    // Cardinal curb edges & small lateral work offsets along each edge
    const localCandidates = [
      { lx: 0, lz: edgeZ },
      { lx: 0, lz: -edgeZ },
      { lx: edgeX, lz: 0 },
      { lx: -edgeX, lz: 0 },
      { lx: 0.28, lz: edgeZ },
      { lx: -0.28, lz: edgeZ },
      { lx: 0.28, lz: -edgeZ },
      { lx: -0.28, lz: -edgeZ },
      { lx: edgeX, lz: 0.28 },
      { lx: edgeX, lz: -0.28 },
      { lx: -edgeX, lz: 0.28 },
      { lx: -edgeX, lz: -0.28 },
    ]

    const worldCandidates = localCandidates.map((pt) => toWorld(pt.lx, pt.lz))
    // Also evaluate the player's current safe position as a natural zero-step fallback
    worldCandidates.push({ x: playerPos.x, z: playerPos.z })

    let best = null
    let bestScore = -Infinity

    for (let i = 0; i < worldCandidates.length; i += 1) {
      const cand = worldCandidates[i]
      const isCurrentFallback = i === worldCandidates.length - 1
      const evaluated = this._evaluateApproachCandidate(
        hazard,
        playerPos,
        cand,
        grateCenter,
        moveRadius
      )
      if (!evaluated) continue

      // Ideal kneeling reach distance from pit center is ~1.45..1.55 m (just outside steel curb)
      const idealDistErr = Math.abs(evaluated.distCenter - 1.48)
      const score =
        100 -
        idealDistErr * 18 -
        evaluated.moveDist * 14 -
        (isCurrentFallback ? 3 : 0)

      if (score > bestScore) {
        bestScore = score
        best = evaluated
      }
    }

    if (!best) {
      return null
    }

    const dx = best.x - grateCenter.x
    const dz = best.z - grateCenter.z
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    const len = Math.hypot(lx, lz)
    const approachLocalDir =
      len > 1e-4 ? { lx: lx / len, lz: lz / len } : { lx: 0, lz: 1 }

    return {
      x: best.x,
      z: best.z,
      distCenter: best.distCenter,
      moveDist: best.moveDist,
      approachLocalDir,
    }
  }

  _findReachableCollapsedGrate(playerPos = null) {
    const pos = playerPos || this.engine?._playerWorldPos
    const hazards = this.engine?.hazardManager?.getHazards?.()
    if (!pos || !Array.isArray(hazards)) return null

    let bestHaz = null
    let bestDist = Infinity
    for (let i = 0; i < hazards.length; i += 1) {
      const h = hazards[i]
      if (
        h &&
        h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE &&
        !h.isDisposed &&
        (h.state === HAZARD_STATES.DISABLED || h.isPermanentlyCollapsed) &&
        !h.isAftermathCleared
      ) {
        const center = this._getGrateCenter(h)
        if (!center) continue
        const d = Math.hypot(pos.x - center.x, pos.z - center.z)
        if (d <= FLOOR_GRATE_ANIM_CONFIG.maxReachDistance && d < bestDist) {
          bestDist = d
          bestHaz = h
        }
      }
    }
    return bestHaz
  }

  /**
   * Single source of truth for whether floor-grate securing can start right now.
   * Consulted by BOTH `HazardAgent.canPlayerInteract` (prompt visibility) and
   * `tryStartSecure` (click dispatch) so prompts and clicks never diverge.
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
    if (this._state === FLOOR_GRATE_STATES.SECURING) {
      return { ok: false, reason: 'already_active' }
    }
    if (this.engine.hidingSpotManager?.isPlayerHiding?.()) {
      return { ok: false, reason: 'hiding' }
    }
    if (
      this.engine.rubbleController?.isActive?.() ||
      this.engine.furnitureController?.isActive?.() ||
      this.engine.pipesController?.isActive?.() ||
      this.engine.steamRepairController?.isActive?.() ||
      this.engine.electricalWiringController?.isActive?.()
    ) {
      return { ok: false, reason: 'busy_other_controller' }
    }

    const playerPos = options?.playerWorldPos || this.engine._playerWorldPos
    const activeHaz = hazard || this._findReachableCollapsedGrate(playerPos)
    if (!activeHaz) {
      return { ok: false, reason: 'no_target' }
    }
    const isCollapsed =
      activeHaz.state === HAZARD_STATES.DISABLED || activeHaz.isPermanentlyCollapsed
    if (
      activeHaz.type !== HAZARD_TYPES.COLLAPSING_FLOOR_GRATE ||
      activeHaz.isDisposed ||
      !isCollapsed ||
      activeHaz.isAftermathCleared
    ) {
      return { ok: false, reason: 'invalid_target' }
    }

    const grateCenter = this._getGrateCenter(activeHaz)
    if (!playerPos || !grateCenter) {
      return { ok: false, reason: 'missing_context' }
    }

    const dist = Math.hypot(playerPos.x - grateCenter.x, playerPos.z - grateCenter.z)
    if (dist > FLOOR_GRATE_ANIM_CONFIG.maxReachDistance) {
      return { ok: false, reason: 'out_of_range' }
    }

    const moveRadius = this._getMoveRadius()
    if (!this._isPositionSafeFromGrate(activeHaz, playerPos.x, playerPos.z, moveRadius)) {
      return { ok: false, reason: 'unsafe_inside_pit' }
    }

    const maze = this.engine._currentMaze
    const propColliders =
      options?.propColliders !== undefined
        ? options.propColliders
        : this.engine._propCollisionIndex || null

    if (
      !this._hasClearSightToGrate(
        playerPos.x,
        playerPos.z,
        grateCenter,
        maze,
        propColliders,
        activeHaz.id
      )
    ) {
      return { ok: false, reason: 'blocked_los' }
    }

    const approach = this._resolveSafeApproachTarget(activeHaz, playerPos)
    if (!approach) {
      return { ok: false, reason: 'no_safe_position' }
    }

    return {
      ok: true,
      hazard: activeHaz,
      playerPos,
      grateCenter,
      approach,
    }
  }

  /**
   * Non-mutating check used by `HazardAgent.canPlayerInteract` so the interaction prompt
   * is displayed if and only if a left-click can actually initiate securing.
   */
  canStartSecure(hazard = null, options = null) {
    return this._evaluateStartEligibility(hazard, options).ok
  }

  /**
   * Non-mutating check used by `viewportPointerCapture` on unlocked mouse `pointerdown`
   * so clicking a collapsed floor grate starts securing immediately without being swallowed
   * by drag-look if the pointer jitters >6 px.
   */
  canQuickStart(ndc = null) {
    if (this.isDisposed || !this.engine || this.isActive()) {
      return false
    }
    const eligibility = this._evaluateStartEligibility(null, null)
    if (!eligibility.ok || !eligibility.hazard) {
      return false
    }

    const camera = this.engine.camera
    if (!camera || !ndc || (!Number.isFinite(ndc.x) && !Number.isFinite(ndc.y))) {
      return true
    }

    const clickX = Number.isFinite(ndc.x) ? ndc.x : 0
    const clickY = Number.isFinite(ndc.y) ? ndc.y : 0
    const haz = eligibility.hazard
    const center = eligibility.grateCenter
    const yaw = Number.isFinite(haz.grateYaw) ? haz.grateYaw : 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const hw = (haz.pitInnerHalfW ?? FLOOR_GRATE_CONSTANTS.pitInnerHalfW) + 0.14
    const hd = (haz.pitInnerHalfD ?? FLOOR_GRATE_CONSTANTS.pitInnerHalfD) + 0.14

    const samplePoints = [
      { x: center.x, y: 0.04, z: center.z },
      { x: center.x + hw * cos, y: 0.04, z: center.z - hw * sin },
      { x: center.x - hw * cos, y: 0.04, z: center.z + hw * sin },
      { x: center.x + hd * sin, y: 0.04, z: center.z + hd * cos },
      { x: center.x - hd * sin, y: 0.04, z: center.z - hd * cos },
    ]

    let minNdcDist = Infinity
    for (let i = 0; i < samplePoints.length; i += 1) {
      const pt = samplePoints[i]
      _tmpProjVec.set(pt.x, pt.y, pt.z).project(camera)
      if (_tmpProjVec.z < -1 || _tmpProjVec.z > 1) continue
      const d = Math.hypot(_tmpProjVec.x - clickX, _tmpProjVec.y - clickY)
      if (d < minNdcDist) minNdcDist = d
    }

    if (minNdcDist <= 0.42) {
      return true
    }

    // Also allow center crosshair quick-start when the crosshair itself is on the grate
    if (Math.abs(clickX) <= 0.18 && Math.abs(clickY) <= 0.18) {
      let minCenterDist = Infinity
      for (let i = 0; i < samplePoints.length; i += 1) {
        const pt = samplePoints[i]
        _tmpProjVec.set(pt.x, pt.y, pt.z).project(camera)
        if (_tmpProjVec.z < -1 || _tmpProjVec.z > 1) continue
        const d = Math.hypot(_tmpProjVec.x, _tmpProjVec.y)
        if (d < minCenterDist) minCenterDist = d
      }
      if (minCenterDist <= 0.48) {
        return true
      }
    }

    return false
  }

  /**
   * Starts the physical collapsing floor grate securing sequence.
   */
  tryStartSecure(hazard = null) {
    const eligibility = this._evaluateStartEligibility(hazard, null)
    if (!eligibility.ok) {
      return { handled: false, reason: eligibility.reason }
    }

    const { hazard: activeHaz, playerPos, grateCenter, approach } = eligibility

    this._state = FLOOR_GRATE_STATES.SECURING
    this._activeHazard = activeHaz
    this._elapsed = 0
    this._duration = FLOOR_GRATE_ANIM_CONFIG.secureDurationSec
    this._progress = 0
    this._securingCommitted = false

    this._startPos.x = playerPos.x
    this._startPos.z = playerPos.z
    this._approachPos.x = approach.x
    this._approachPos.z = approach.z
    this._approachLocalDir.lx = approach.approachLocalDir.lx
    this._approachLocalDir.lz = approach.approachLocalDir.lz
    this._needsApproach = approach.moveDist > 0.03

    const faceDx = grateCenter.x - approach.x
    const faceDz = grateCenter.z - approach.z
    this._targetYaw = Math.atan2(-faceDx, -faceDz)
    this._startYaw =
      this.engine._playerGroup?.rotation?.y ??
      this.engine.cameraRig?.getCharacterDirection?.()?.yaw ??
      this.engine.cameraRig?.getLookDirection?.()?.yaw ??
      this._targetYaw

    activeHaz.setGrateSecureProgress?.(0, this._approachLocalDir)
    this.engine.syncPlayerVisibility?.()
    this.engine._notifyStealthChange?.(true)

    return {
      handled: true,
      action: 'secure_floor_opening',
      hazard: activeHaz,
      isSecuring: true,
      clearAftermath: false,
      emitSoundRange: 0,
    }
  }

  /**
   * Called by `MazeSceneEngine.stepMovement` whenever WASD or sprint input is received.
   */
  onMovementInput(hasMovementInput = false) {
    if (!hasMovementInput) return false
    if (this._state === FLOOR_GRATE_STATES.SECURING) {
      this.interruptSecure({ immediate: false, reason: 'movement' })
      return true
    }
    return false
  }

  /**
   * Safely cancels an active floor-grate securing animation.
   * If interrupted before the atomic commit point (`completionProgress`), the open pit
   * remains open, its aftermath collider remains enabled, `securedCoverGroup` resets cleanly
   * to hidden, and zero completion audio cues are emitted.
   */
  interruptSecure(options = null) {
    const immediate = Boolean(options?.immediate)
    const reason = options?.reason || 'interrupted'
    if (this._state !== FLOOR_GRATE_STATES.SECURING && !this._activeHazard) {
      this._state = FLOOR_GRATE_STATES.IDLE
      this._progress = 0
      return false
    }

    const prevHazard = this._activeHazard
    const wasCommitted = this._securingCommitted

    if (prevHazard && !prevHazard.isDisposed && !wasCommitted) {
      prevHazard.setGrateSecureProgress?.(0)
    }

    this._state = FLOOR_GRATE_STATES.IDLE
    this._activeHazard = null
    this._elapsed = 0
    this._progress = 0
    this._securingCommitted = false
    this._needsApproach = false
    this._animatorPayload.mode = FLOOR_GRATE_ANIM_MODES.NONE
    this._animatorPayload.progress = 0
    this._animatorPayload.phase = 'idle'
    this._animatorPayload.active = false

    if (this.engine?._motionSample) {
      this.engine._motionSample.floorGrate = null
    }
    if (immediate) {
      this.engine?._playerAnimator?.clearFloorGrateState?.()
    }
    this.engine?.syncPlayerVisibility?.()
    this.engine?._notifyStealthChange?.(true)
    return { interrupted: true, reason, committed: wasCommitted }
  }

  _commitSecuring(hazard) {
    if (this._securingCommitted || !hazard || hazard.isDisposed) return false
    this._securingCommitted = true

    hazard.setGrateSecureProgress?.(1, this._approachLocalDir)
    hazard.clearAftermath?.()

    this.engine?._syncHazardColliders?.({ allowPushOut: false })
    const anchor = this._getGrateCenter(hazard) || this.engine?._playerWorldPos
    if (anchor) {
      this.engine?.emitSound?.(anchor, FLOOR_GRATE_ANIM_CONFIG.soundEmitRange, 0.5)
      this.engine?.audioEngine?.onHazardInteraction?.(
        'secure_floor_opening',
        hazard.type,
        anchor
      )
    }
    this.engine?._notifyStealthChange?.(true)
    return true
  }

  update(delta = 0) {
    if (this.isDisposed || !this.engine) return
    if (this._state !== FLOOR_GRATE_STATES.SECURING) return

    const dt = Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0
    const haz = this._activeHazard
    const playerPos = this.engine._playerWorldPos
    const maze = this.engine._currentMaze

    if (
      !haz ||
      haz.isDisposed ||
      !playerPos ||
      !maze ||
      this.engine.isGameOver ||
      this.engine.hasWon ||
      this.engine.isPaused
    ) {
      this.interruptSecure({ immediate: true, reason: 'invalid_state' })
      return
    }

    const isStillCollapsed =
      haz.state === HAZARD_STATES.DISABLED || haz.isPermanentlyCollapsed
    if (!this._securingCommitted && (!isStillCollapsed || haz.isAftermathCleared)) {
      this.interruptSecure({ immediate: true, reason: 'hazard_state_changed' })
      return
    }

    const grateCenter = this._getGrateCenter(haz)
    if (!grateCenter) {
      this.interruptSecure({ immediate: true, reason: 'missing_center' })
      return
    }

    const moveRadius = this._getMoveRadius()
    const currentDist = Math.hypot(
      playerPos.x - grateCenter.x,
      playerPos.z - grateCenter.z
    )
    if (currentDist > FLOOR_GRATE_ANIM_CONFIG.maxActiveBreakoutDistance) {
      this.interruptSecure({ immediate: false, reason: 'out_of_range' })
      return
    }

    if (
      !this._securingCommitted &&
      !this._isPositionSafeFromGrate(haz, playerPos.x, playerPos.z, moveRadius)
    ) {
      this.interruptSecure({ immediate: true, reason: 'entered_pit_area' })
      return
    }

    this._elapsed += dt
    this._progress = clamp(this._elapsed / Math.max(0.1, this._duration), 0, 1)

    // Phase A (0.00..0.20): Smooth collision-safe approach to working edge & facing alignment
    const approachT = smoothstep01(
      this._progress / Math.max(0.05, FLOOR_GRATE_ANIM_CONFIG.approachEndProgress)
    )
    if (this._needsApproach && this._progress <= FLOOR_GRATE_ANIM_CONFIG.approachEndProgress + 0.05) {
      const targetX = lerp(this._startPos.x, this._approachPos.x, approachT)
      const targetZ = lerp(this._startPos.z, this._approachPos.z, approachT)
      const stepDx = targetX - playerPos.x
      const stepDz = targetZ - playerPos.z
      if (Math.hypot(stepDx, stepDz) > 1e-4) {
        // Respect walls, props, AND the open pit collider during approach!
        const res = moveWithSubsteps(
          playerPos.x,
          playerPos.z,
          stepDx,
          stepDz,
          maze,
          {
            radius: moveRadius,
            propColliders: this.engine._propCollisionIndex || null,
            allowStepOver: true,
          }
        )
        if (
          this._securingCommitted ||
          this._isPositionSafeFromGrate(haz, res.x, res.z, moveRadius)
        ) {
          playerPos.x = res.x
          playerPos.z = res.z
          if (this.engine._playerGroup) {
            this.engine._playerGroup.position.x = res.x
            this.engine._playerGroup.position.z = res.z
          }
          if (this.engine.cameraRig) {
            this.engine.cameraRig.setPlayerPosition(
              playerPos.x,
              playerPos.y,
              playerPos.z
            )
          }
        }
      }
    }

    // Smoothly turn the character body to face the open pit without snapping Free Look camera
    if (this.engine._playerGroup && this._progress < FLOOR_GRATE_ANIM_CONFIG.completionProgress) {
      const curYaw = this.engine._playerGroup.rotation.y
      const diff = shortestAngleDiff(this._targetYaw, curYaw)
      const turnAlpha = dt > 0 ? 1 - Math.exp(-12 * dt) : 1
      const nextYaw = Math.abs(diff) < 1e-3 ? this._targetYaw : curYaw + diff * turnAlpha
      this.engine._playerGroup.rotation.y = nextYaw
      if (this.engine.cameraRig) {
        if (this.engine.cameraRig.isFreeLookActive?.()) {
          this.engine.cameraRig.setCharacterYaw?.(nextYaw)
        } else if (this.engine.cameraRig.getMode?.() === 'third_person') {
          this.engine.cameraRig.setCharacterYaw?.(nextYaw)
        }
      }
      this.engine._syncFlashlightRig?.()
    }

    // Phase C (0.38..0.80): Physically lower/slide the existing trench cover & seat perimeter bolts
    const coverProgress = computeCoverSecureProgress(this._progress)
    if (!this._securingCommitted) {
      haz.setGrateSecureProgress?.(coverProgress, this._approachLocalDir)
    }

    // Atomic commit strictly at >= completionProgress (0.80)
    if (
      !this._securingCommitted &&
      this._progress >= FLOOR_GRATE_ANIM_CONFIG.completionProgress
    ) {
      this._commitSecuring(haz)
    }

    // Phase E (0.80..1.00): Release & rise cleanly back to standing, then complete
    if (this._progress >= 1) {
      this._state = FLOOR_GRATE_STATES.SECURED
      this._activeHazard = null
      this._elapsed = 0
      this._progress = 0
      this._needsApproach = false
      this._animatorPayload.mode = FLOOR_GRATE_ANIM_MODES.NONE
      this._animatorPayload.progress = 0
      this._animatorPayload.phase = 'idle'
      this._animatorPayload.active = false
      if (this.engine._motionSample) {
        this.engine._motionSample.floorGrate = null
      }
      this.engine.syncPlayerVisibility?.()
      this.engine._notifyStealthChange?.(true)
    }
  }

  reset() {
    this.interruptSecure({ immediate: true, reason: 'reset' })
    this._state = FLOOR_GRATE_STATES.IDLE
  }

  dispose() {
    if (this.isDisposed) return false
    this.reset()
    this.isDisposed = true
    this.engine = null
    return true
  }
}
