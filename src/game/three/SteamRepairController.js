import * as THREE from 'three'
import { HAZARD_STATES } from './HazardAgent.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'

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
  repairDurationSec: 1.45,
  maxReachDistance: 2.35,
  soundEmitRange: 4.0,
})

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function smoothstep01(t) {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
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
    this._stateProgress = 0
    this._activeHazard = null
    this._repairTargetYaw = 0
    this._repairStartYaw = 0
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

  tryStartRepair(hazard = null) {
    if (this.isDisposed || !this.engine || this.engine.isGameOver || this.engine.hasWon || this.engine.isPaused) {
      return { handled: false, reason: 'unavailable' }
    }
    if (this._state !== STEAM_REPAIR_STATES.IDLE) {
      return { handled: false, reason: 'already_active' }
    }
    const activeHaz = hazard || this._findReachableSteamHazard()
    if (!activeHaz) {
      return { handled: false, reason: 'no_target' }
    }

    const playerPos = this.engine._playerWorldPos
    const anchor = activeHaz.getInteractionAnchor?.() || activeHaz.worldPos || activeHaz.cellWorldPos
    if (!playerPos || !anchor) {
      return { handled: false, reason: 'missing_context' }
    }

    const dist = Math.hypot(playerPos.x - anchor.x, playerPos.z - anchor.z)
    if (dist > STEAM_REPAIR_CONFIG.maxReachDistance) {
      return { handled: false, reason: 'out_of_range' }
    }

    this._activeHazard = activeHaz
    this._state = STEAM_REPAIR_STATES.REPAIRING
    this._stateTimer = 0
    this._stateProgress = 0

    const curYaw = this._getPlayerFacingYaw()
    this._repairStartYaw = curYaw
    const dx = anchor.x - playerPos.x
    const dz = anchor.z - playerPos.z
    if (dx * dx + dz * dz > 1e-4) {
      this._repairTargetYaw = Math.atan2(-dx, -dz)
    } else {
      this._repairTargetYaw = curYaw
    }

    this.engine._notifyStealthChange?.(true)
    return {
      handled: true,
      action: 'seal_steam_pipe',
      hazardId: activeHaz.id,
      state: this._state,
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
        const anchor = h.getInteractionAnchor?.() || h.worldPos || h.cellWorldPos
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

  interruptRepair({ immediate = false } = {}) {
    if (this._state === STEAM_REPAIR_STATES.IDLE) {
      return false
    }
    const hazard = this._activeHazard
    if (hazard && typeof hazard.setRepairProgress === 'function') {
      hazard.setRepairProgress(0)
    }

    this._activeHazard = null
    this._state = STEAM_REPAIR_STATES.IDLE
    this._stateTimer = 0
    this._stateProgress = 0
    this.engine?._notifyStealthChange?.(true)
    return true
  }

  onMovementInput(hasMovementInput) {
    if (!hasMovementInput || this.isDisposed) return false
    if (this._state === STEAM_REPAIR_STATES.REPAIRING) {
      this.interruptRepair({ immediate: true })
      return true
    }
    return false
  }

  update(delta = 0) {
    if (this.isDisposed || !this.engine || this._state !== STEAM_REPAIR_STATES.REPAIRING) {
      return
    }
    const dt = Number.isFinite(delta) && delta > 0 ? delta : 0
    const hazard = this._activeHazard
    if (!hazard || hazard.isDisposed || hazard.state !== HAZARD_STATES.ACTIVE) {
      this.interruptRepair({ immediate: true })
      return
    }

    this._stateTimer += dt
    const dur = STEAM_REPAIR_CONFIG.repairDurationSec
    this._stateProgress = clamp(this._stateTimer / dur, 0, 1)

    if (typeof hazard.setRepairProgress === 'function') {
      hazard.setRepairProgress(this._stateProgress)
    }

    if (this.engine._playerGroup) {
      const turnT = smoothstep01(this._stateProgress / 0.4)
      const diff = shortestAngleDiff(this._repairTargetYaw, this._repairStartYaw)
      const nextYaw = this._repairStartYaw + diff * turnT
      this.engine._playerGroup.rotation.y = nextYaw
      if (this.engine.cameraRig?.isFreeLookActive?.()) {
        this.engine.cameraRig.setCharacterYaw?.(nextYaw)
      }
    }

    if (this._stateProgress >= 1) {
      hazard.state = HAZARD_STATES.DISABLED
      hazard.isPermanentlyCollapsed = true
      hazard.isAftermathCleared = true
      hazard._syncColliderStates?.(1)
      if (typeof hazard.setRepairProgress === 'function') {
        hazard.setRepairProgress(1)
      }
      if (hazard.mesh?.userData) {
        hazard.mesh.userData.isAftermathCleared = true
        hazard.mesh.userData.isPermanentlyCollapsed = true
        if (hazard.mesh.userData.steamCloud) {
          hazard.mesh.userData.steamCloud.visible = false
        }
        if (hazard.mesh.userData.steamMat) {
          hazard.mesh.userData.steamMat.opacity = 0
        }
        if (hazard.mesh.userData.repairPatchGroup) {
          hazard.mesh.userData.repairPatchGroup.visible = true
          hazard.mesh.userData.repairPatchGroup.scale.set(1, 1, 1)
        }
      }

      const anchor = hazard.getInteractionAnchor?.() || this.engine._playerWorldPos
      this.engine.emitSound?.(anchor, STEAM_REPAIR_CONFIG.soundEmitRange, 0.55)
      this.engine._syncHazardColliders?.({ allowPushOut: false })

      this._state = STEAM_REPAIR_STATES.REPAIRED
      this._activeHazard = null
      this._stateTimer = 0
      this._stateProgress = 1
      this.engine?._notifyStealthChange?.(true)
    }
  }

  getAnimatorPayload() {
    if (this.isDisposed || this._state === STEAM_REPAIR_STATES.IDLE) {
      return {
        mode: STEAM_REPAIR_ANIM_MODES.NONE,
        progress: 0,
      }
    }
    return {
      mode: STEAM_REPAIR_ANIM_MODES.REPAIR,
      progress: this._stateProgress,
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
    }
  }

  reset() {
    if (this._activeHazard && typeof this._activeHazard.setRepairProgress === 'function') {
      this._activeHazard.setRepairProgress(0)
    }
    this._activeHazard = null
    this._state = STEAM_REPAIR_STATES.IDLE
    this._stateTimer = 0
    this._stateProgress = 0
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._soundCooldown = 0
  }

  dispose() {
    if (this.isDisposed) return
    this.isDisposed = true
    this.reset()
    this.engine = null
  }
}
