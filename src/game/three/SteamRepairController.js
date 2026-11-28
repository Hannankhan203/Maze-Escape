import { HAZARD_STATES } from './HazardAgent.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { hasLineOfSightInMaze, moveWithSubsteps } from '../world/gridCollision.js'
import { PLAYER_RADIUS } from '../world/worldCoords.js'
import { updateHazardVisualState } from './buildHazards.js'

export const STEAM_REPAIR_STATES = Object.freeze({
  IDLE: 'idle',
  REPAIRING: 'repairing',
  REPAIRED: 'repaired',
})

export const STEAM_REPAIR_ANIM_MODES = Object.freeze({
  NONE: 'none',
  REPAIR: 'repair',
})

export const STEAM_REPAIR_CONFIG = Object.freeze({
  repairDurationSec: 2.15,
  minResumeDurationSec: 1.1,
  maxReachDistance: 2.35,
  maxActiveBreakoutDistance: 2.75,
  standoffDistance: 1.85,
  approachEndProgress: 0.16,
  tapeApplyEndProgress: 0.9,
  soundEmitRange: 4.0,
})

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

export class SteamRepairController {
  constructor(engine) {
    this.engine = engine || null
    this.isDisposed = false

    this._state = STEAM_REPAIR_STATES.IDLE
    this._stateTimer = 0
    this._activeDurationSec = STEAM_REPAIR_CONFIG.repairDurationSec
    this._stateProgress = 0
    this._tapeProgress = 0
    this._resumeTapeBase = 0
    this._activeHazard = null
    this._repairTargetYaw = 0
    this._repairStartYaw = 0
    this._repairStartPos = { x: 0, z: 0 }
    this._repairTargetPos = { x: 0, z: 0 }
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._soundCooldown = 0
  }

  getStateName() {
    return this._state
  }

  isActive() {
    return !this.isDisposed && this._state === STEAM_REPAIR_STATES.REPAIRING
  }

  isRepairing() {
    return this.isActive()
  }

  getActiveHazard() {
    return this._activeHazard
  }

  _getHazardAnchor(hazard) {
    if (!hazard) return null
    return (
      hazard.getInteractionAnchor?.() ||
      hazard.originWorldPos ||
      hazard.worldPos ||
      hazard.cellWorldPos ||
      null
    )
  }

  _resolveSafeStandoffTarget(hazard, playerPos, anchor) {
    const maze = this.engine?._currentMaze || null
    const propColliders = this.engine?._propCollisionIndex || null
    const moveRadius = Number.isFinite(this.engine?.movementConfig?.radius)
      ? this.engine.movementConfig.radius
      : PLAYER_RADIUS

    let steamYaw = 0
    if (Number.isFinite(hazard?.steamYaw)) {
      steamYaw = hazard.steamYaw
    } else if (
      hazard?.ruptureDir &&
      (hazard.ruptureDir.x !== 0 || hazard.ruptureDir.z !== 0)
    ) {
      steamYaw = Math.atan2(hazard.ruptureDir.x, hazard.ruptureDir.z)
    }

    const cos = Math.cos(steamYaw)
    const sin = Math.sin(steamYaw)
    // pipeDir is along the longitudinal pipe axis (perpendicular to steam plume)
    const pipeDir = { x: cos, z: -sin }
    // steamDir is along the escaping steam plume (into corridor)
    const steamDir = { x: sin, z: cos }

    // Prioritize side closer to the player's approach position
    const toPlayerX = playerPos.x - anchor.x
    const toPlayerZ = playerPos.z - anchor.z
    const playerSideProj = toPlayerX * pipeDir.x + toPlayerZ * pipeDir.z
    const primarySign = playerSideProj >= 0 ? 1 : -1
    const secondarySign = -primarySign

    // Offsets relative to anchor: { pOff along pipeDir, sOff along steamDir }
    // Safe-side standoff keeps full collision bounds outside steam plume [minZ, maxZ] x [minX, maxX]
    const candidatePairs = [
      {
        pOff: primarySign > 0 ? 1.76 : -1.8,
        sOff: 0.52,
      },
      {
        pOff: primarySign > 0 ? 1.82 : -1.86,
        sOff: 0.56,
      },
      {
        pOff: primarySign > 0 ? 1.74 : -1.78,
        sOff: 0.6,
      },
      {
        pOff: secondarySign > 0 ? 1.76 : -1.8,
        sOff: 0.52,
      },
      {
        pOff: secondarySign > 0 ? 1.82 : -1.86,
        sOff: 0.56,
      },
      {
        pOff: secondarySign > 0 ? 1.74 : -1.78,
        sOff: 0.6,
      },
    ]

    let bestPos = null
    let bestScore = -Infinity

    for (let i = 0; i < candidatePairs.length; i += 1) {
      const { pOff, sOff } = candidatePairs[i]
      const wx = anchor.x + pOff * pipeDir.x + sOff * steamDir.x
      const wz = anchor.z + pOff * pipeDir.z + sOff * steamDir.z

      // Plume safety check: must be outside steam damage envelope
      if (typeof hazard?._isPointInSteamPlumeArea === 'function') {
        if (hazard._isPointInSteamPlumeArea(wx, wz, 0.45)) {
          continue
        }
      }

      if (!maze?.grid) {
        return { x: wx, z: wz }
      }

      // Collision-aware approach movement
      const stepped = moveWithSubsteps(
        playerPos.x,
        playerPos.z,
        wx - playerPos.x,
        wz - playerPos.z,
        maze,
        {
          radius: moveRadius,
          propColliders,
          ignoreOwnerId: hazard.id,
        }
      )

      // Reachability & standoff distance bounds
      const resultingDist = Math.hypot(stepped.x - anchor.x, stepped.z - anchor.z)
      if (
        resultingDist > STEAM_REPAIR_CONFIG.maxReachDistance ||
        resultingDist < 0.35
      ) {
        continue
      }

      // Line of sight between safe repair stance and pipe rupture
      const losOk = hasLineOfSightInMaze(
        stepped.x,
        stepped.z,
        anchor.x,
        anchor.z,
        maze
      )
      if (!losOk) {
        continue
      }

      // Ensure full character collision bounds at stepped position remain outside plume
      if (typeof hazard?._isPointInSteamPlumeArea === 'function') {
        if (hazard._isPointInSteamPlumeArea(stepped.x, stepped.z, 0.45)) {
          continue
        }
      }

      // Candidate scoring
      const distToPlayer = Math.hypot(
        stepped.x - playerPos.x,
        stepped.z - playerPos.z
      )
      const distDiff = Math.abs(resultingDist - STEAM_REPAIR_CONFIG.standoffDistance)
      const score = 100 - distToPlayer * 2 - distDiff * 6 - i * 0.5
      if (score > bestScore) {
        bestScore = score
        bestPos = { x: stepped.x, z: stepped.z }
      }
    }

    return bestPos
  }

  tryStartRepair(hazard = null) {
    if (
      this.isDisposed ||
      !this.engine ||
      this.engine.isGameOver ||
      this.engine.hasWon ||
      this.engine.isPaused
    ) {
      return { handled: false, reason: 'unavailable' }
    }
    if (this._state === STEAM_REPAIR_STATES.REPAIRING) {
      return { handled: false, reason: 'already_active' }
    }
    if (
      this.engine.rubbleController?.isActive?.() ||
      this.engine.furnitureController?.isActive?.() ||
      this.engine.pipesController?.isActive?.()
    ) {
      return { handled: false, reason: 'busy_other_controller' }
    }

    const activeHaz = hazard || this._findReachableSteamHazard()
    if (!activeHaz) {
      return { handled: false, reason: 'no_target' }
    }
    if (
      activeHaz.type !== HAZARD_TYPES.STEAM_PIPE_BURST ||
      activeHaz.isDisposed ||
      activeHaz.state !== HAZARD_STATES.ACTIVE ||
      activeHaz.isAftermathCleared
    ) {
      return { handled: false, reason: 'invalid_target' }
    }

    const playerPos = this.engine._playerWorldPos
    const anchor = this._getHazardAnchor(activeHaz)
    if (!playerPos || !anchor) {
      return { handled: false, reason: 'missing_context' }
    }

    const dist = Math.hypot(playerPos.x - anchor.x, playerPos.z - anchor.z)
    if (dist > STEAM_REPAIR_CONFIG.maxReachDistance) {
      return { handled: false, reason: 'out_of_range' }
    }

    if (
      this.engine._currentMaze?.grid &&
      !hasLineOfSightInMaze(
        playerPos.x,
        playerPos.z,
        anchor.x,
        anchor.z,
        this.engine._currentMaze
      )
    ) {
      return { handled: false, reason: 'obstructed' }
    }

    const targetPos = this._resolveSafeStandoffTarget(
      activeHaz,
      playerPos,
      anchor
    )
    if (!targetPos) {
      return { handled: false, reason: 'unsafe_position' }
    }

    const prevRaw = Number(activeHaz.repairProgress)
    const resumedBase =
      Number.isFinite(prevRaw) && prevRaw > 0.02 && prevRaw < 0.99
        ? clamp(prevRaw, 0, 0.88)
        : 0

    this._activeHazard = activeHaz
    this._state = STEAM_REPAIR_STATES.REPAIRING
    this._stateTimer = 0
    this._stateProgress = 0
    this._resumeTapeBase = resumedBase
    this._tapeProgress = resumedBase
    this._activeDurationSec =
      resumedBase > 0
        ? Math.max(
            STEAM_REPAIR_CONFIG.minResumeDurationSec,
            STEAM_REPAIR_CONFIG.repairDurationSec * (1 - resumedBase * 0.55)
          )
        : STEAM_REPAIR_CONFIG.repairDurationSec

    this._repairStartPos = { x: playerPos.x, z: playerPos.z }
    this._repairTargetPos = targetPos

    const curYaw = this._getPlayerFacingYaw()
    this._repairStartYaw = curYaw
    const dx = anchor.x - this._repairTargetPos.x
    const dz = anchor.z - this._repairTargetPos.z
    if (dx * dx + dz * dz > 1e-4) {
      this._repairTargetYaw = Math.atan2(-dx, -dz)
    } else {
      const fdx = anchor.x - playerPos.x
      const fdz = anchor.z - playerPos.z
      this._repairTargetYaw =
        fdx * fdx + fdz * fdz > 1e-4 ? Math.atan2(-fdx, -fdz) : curYaw
    }

    this.engine.syncPlayerVisibility?.()
    this.engine._notifyStealthChange?.(true)
    return {
      handled: true,
      action: 'seal_steam_pipe',
      hazardId: activeHaz.id,
      state: this._state,
      resumedFromProgress: resumedBase,
    }
  }

  _getPlayerFacingYaw() {
    return (
      this.engine?._playerGroup?.rotation?.y ??
      this.engine?.cameraRig?.getCharacterDirection?.()?.yaw ??
      this.engine?.cameraRig?.getLookDirection?.()?.yaw ??
      0
    )
  }

  _findReachableSteamHazard() {
    const hazards = this.engine?.hazardManager?.getHazards?.()
    if (!Array.isArray(hazards) || hazards.length === 0) return null
    const playerPos = this.engine?._playerWorldPos
    if (!playerPos) return null

    let bestHaz = null
    let bestDist = Infinity
    for (let i = 0; i < hazards.length; i += 1) {
      const h = hazards[i]
      if (
        h &&
        h.type === HAZARD_TYPES.STEAM_PIPE_BURST &&
        !h.isDisposed &&
        h.state === HAZARD_STATES.ACTIVE &&
        !h.isAftermathCleared
      ) {
        const anchor = this._getHazardAnchor(h)
        if (anchor) {
          const d = Math.hypot(playerPos.x - anchor.x, playerPos.z - anchor.z)
          if (d <= STEAM_REPAIR_CONFIG.maxReachDistance && d < bestDist) {
            bestDist = d
            bestHaz = h
          }
        }
      }
    }
    return bestHaz
  }

  interruptRepair() {
    if (this._state !== STEAM_REPAIR_STATES.REPAIRING) {
      return false
    }
    const hazard = this._activeHazard
    if (hazard && typeof hazard.setRepairProgress === 'function') {
      const preserved =
        this._tapeProgress > 0.02 && this._tapeProgress < 1
          ? this._tapeProgress
          : Number(hazard.repairProgress) || 0
      hazard.setRepairProgress(preserved < 1 ? preserved : 0)
    }

    this._activeHazard = null
    this._state = STEAM_REPAIR_STATES.IDLE
    this._stateTimer = 0
    this._stateProgress = 0
    this._tapeProgress = 0
    this._resumeTapeBase = 0
    this.engine?.syncPlayerVisibility?.()
    this.engine?._notifyStealthChange?.(true)
    return true
  }

  onMovementInput(hasMovementInput) {
    if (!hasMovementInput || this.isDisposed) return false
    if (this._state === STEAM_REPAIR_STATES.REPAIRING) {
      this.interruptRepair({ immediate: true, reason: 'movement' })
      return true
    }
    return false
  }

  update(delta = 0) {
    if (
      this.isDisposed ||
      !this.engine ||
      this._state !== STEAM_REPAIR_STATES.REPAIRING
    ) {
      return
    }
    if (this.engine.isGameOver || this.engine.hasWon || this.engine.isPaused) {
      this.interruptRepair({ immediate: true, reason: 'paused_or_ended' })
      return
    }

    const dt = Number.isFinite(delta) && delta > 0 ? delta : 0
    const hazard = this._activeHazard
    const playerPos = this.engine._playerWorldPos
    const anchor = this._getHazardAnchor(hazard)
    if (
      !hazard ||
      hazard.isDisposed ||
      hazard.state !== HAZARD_STATES.ACTIVE ||
      hazard.isAftermathCleared ||
      !playerPos ||
      !anchor
    ) {
      this.interruptRepair({ immediate: true, reason: 'invalid_state' })
      return
    }

    const dist = Math.hypot(playerPos.x - anchor.x, playerPos.z - anchor.z)
    if (dist > STEAM_REPAIR_CONFIG.maxActiveBreakoutDistance) {
      this.interruptRepair({ immediate: true, reason: 'out_of_range' })
      return
    }

    this._stateTimer += dt
    const dur = Math.max(0.4, this._activeDurationSec)
    this._stateProgress = clamp(this._stateTimer / dur, 0, 1)

    const approachEnd = STEAM_REPAIR_CONFIG.approachEndProgress
    const tapeEnd = STEAM_REPAIR_CONFIG.tapeApplyEndProgress
    if (this._stateProgress <= approachEnd) {
      this._tapeProgress = this._resumeTapeBase
    } else {
      const u = clamp(
        (this._stateProgress - approachEnd) / Math.max(0.05, tapeEnd - approachEnd),
        0,
        1
      )
      this._tapeProgress = lerp(this._resumeTapeBase, 1, u)
    }

    if (typeof hazard.setRepairProgress === 'function') {
      hazard.setRepairProgress(this._tapeProgress)
    }

    // Phase A positioning & turning into reachable stance without wall/prop clipping
    const posT = smoothstep01(this._stateProgress / 0.24)
    const desiredX = lerp(this._repairStartPos.x, this._repairTargetPos.x, posT)
    const desiredZ = lerp(this._repairStartPos.z, this._repairTargetPos.z, posT)
    if (
      Math.hypot(desiredX - playerPos.x, desiredZ - playerPos.z) > 1e-5
    ) {
      let nextX = desiredX
      let nextZ = desiredZ
      if (this.engine._currentMaze?.grid) {
        const moveRadius = Number.isFinite(this.engine?.movementConfig?.radius)
          ? this.engine.movementConfig.radius
          : PLAYER_RADIUS
        const stepped = moveWithSubsteps(
          playerPos.x,
          playerPos.z,
          desiredX - playerPos.x,
          desiredZ - playerPos.z,
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

    const turnT = smoothstep01(this._stateProgress / 0.26)
    const diff = shortestAngleDiff(this._repairTargetYaw, this._repairStartYaw)
    const nextYaw = this._repairStartYaw + diff * turnT
    if (this.engine._playerGroup?.rotation) {
      this.engine._playerGroup.rotation.y = nextYaw
    }
    if (this._stateProgress <= 0.3 || this.engine.cameraRig?.isFreeLookActive?.()) {
      this.engine.cameraRig?.setCharacterYaw?.(nextYaw)
    }

    if (this._stateProgress >= 1) {
      hazard.state = HAZARD_STATES.DISABLED
      hazard.isDisabled = true
      hazard.isPermanentlyCollapsed = true
      hazard.isAftermathCleared = true
      hazard.timer = 0
      hazard.lastMovementEffect = null
      hazard._syncColliderStates?.(1)
      if (typeof hazard.setRepairProgress === 'function') {
        hazard.setRepairProgress(1)
      }
      if (hazard.mesh?.userData) {
        hazard.mesh.userData.isAftermathCleared = true
        hazard.mesh.userData.isPermanentlyCollapsed = true
        hazard.mesh.userData.repairCompletedByTape = true
        hazard.mesh.userData.repairProgress = 1
        if (hazard.mesh.userData.steamCloud) {
          hazard.mesh.userData.steamCloud.visible = false
        }
        if (hazard.mesh.userData.steamPlumeGroup) {
          hazard.mesh.userData.steamPlumeGroup.visible = false
        }
        if (hazard.mesh.userData.steamMat) {
          hazard.mesh.userData.steamMat.opacity = 0
        }
        if (hazard.mesh.userData.repairPatchGroup) {
          hazard.mesh.userData.repairPatchGroup.visible = true
          hazard.mesh.userData.repairPatchGroup.scale.set(1, 1, 1)
        }
      }
      updateHazardVisualState(hazard.mesh, HAZARD_STATES.DISABLED, 1)

      this.engine.audioEngine?.onHazardInteraction?.(
        'seal_steam_pipe',
        hazard.type,
        anchor
      )
      this.engine.emitSound?.(anchor, STEAM_REPAIR_CONFIG.soundEmitRange, 0.55)
      this.engine._syncHazardColliders?.({ allowPushOut: false })

      this._state = STEAM_REPAIR_STATES.REPAIRED
      this._activeHazard = null
      this._stateTimer = 0
      this._stateProgress = 1
      this._tapeProgress = 1
      this._resumeTapeBase = 0
      this.engine.syncPlayerVisibility?.()
      this.engine._notifyStealthChange?.(true)
    }
  }

  getAnimatorPayload() {
    if (
      this.isDisposed ||
      this._state !== STEAM_REPAIR_STATES.REPAIRING
    ) {
      return {
        mode: STEAM_REPAIR_ANIM_MODES.NONE,
        progress: 0,
        tapeProgress: 0,
      }
    }
    return {
      mode: STEAM_REPAIR_ANIM_MODES.REPAIR,
      progress: this._stateProgress,
      tapeProgress: this._tapeProgress,
    }
  }

  getInteractionSnapshot() {
    const reachableHaz = this._findReachableSteamHazard()
    return {
      state: this._state,
      isRepairing: this.isRepairing(),
      activeHazardId: this._activeHazard ? this._activeHazard.id : null,
      reachableHazardId: reachableHaz ? reachableHaz.id : null,
      progress: Math.round(this._stateProgress * 100) / 100,
      tapeProgress: Math.round(this._tapeProgress * 100) / 100,
    }
  }

  reset() {
    if (
      this._activeHazard &&
      typeof this._activeHazard.setRepairProgress === 'function'
    ) {
      this._activeHazard.setRepairProgress(0)
    }
    this._activeHazard = null
    this._state = STEAM_REPAIR_STATES.IDLE
    this._stateTimer = 0
    this._activeDurationSec = STEAM_REPAIR_CONFIG.repairDurationSec
    this._stateProgress = 0
    this._tapeProgress = 0
    this._resumeTapeBase = 0
    this._repairStartPos = { x: 0, z: 0 }
    this._repairTargetPos = { x: 0, z: 0 }
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._soundCooldown = 0
    this.engine?.syncPlayerVisibility?.()
  }

  dispose() {
    if (this.isDisposed) return
    this.isDisposed = true
    this.reset()
    this.engine = null
  }
}
