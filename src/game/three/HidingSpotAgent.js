import {
  DEFAULT_HIDING_INTERACT_RANGE,
  HIDING_SPOT_CONFIG,
  HIDING_SPOT_TYPES,
  isValidHidingSpotType,
  localToWorldSpotOffset,
} from '../mechanics/hidingConfig.js'
import { hasLineOfSightInMaze } from '../world/gridCollision.js'
import {
  buildHidingSpotMesh,
  disposeHidingSpotMesh,
  syncHidingSpotQuality,
  updateHidingSpotVisualState,
} from './buildHidingSpots.js'

/**
 * Runtime controller for an individual hiding spot in the 3D scene.
 * Handles occupancy, dynamic collider toggling, procedural animations,
 * exposure/limitation timers, and player entry/exit prompts.
 */
export class HidingSpotAgent {
  constructor(spec = {}, maze = null) {
    if (!spec?.type || !isValidHidingSpotType(spec.type)) {
      throw new Error(`Unsupported hiding spot type: ${spec?.type}`)
    }

    this.id = spec.id || `hiding-${spec.type}-${spec.row ?? 0}-${spec.col ?? 0}`
    this.type = spec.type
    this.row = spec.row ?? 1
    this.col = spec.col ?? 1
    this.wallSide = spec.wallSide || 'north'
    this.wallRow = spec.wallRow ?? null
    this.wallCol = spec.wallCol ?? null
    this.wallYaw = Number.isFinite(spec.wallYaw) ? spec.wallYaw : 0
    this.maze = maze
    this.config = HIDING_SPOT_CONFIG[this.type]
    this.isDisposed = false

    this.worldPos = {
      x: Number.isFinite(spec.x) ? spec.x : 0,
      y: Number.isFinite(spec.y) ? spec.y : 0,
      z: Number.isFinite(spec.z) ? spec.z : 0,
    }

    const fallbackEntry = localToWorldSpotOffset(
      this.worldPos.x,
      this.worldPos.z,
      this.wallYaw,
      this.config.placement.entryLocal.x,
      this.config.placement.entryLocal.z
    )
    this.entryAnchor = {
      x: Number.isFinite(spec.entryAnchor?.x) ? spec.entryAnchor.x : fallbackEntry.x,
      y: 0,
      z: Number.isFinite(spec.entryAnchor?.z) ? spec.entryAnchor.z : fallbackEntry.z,
    }

    const fallbackInterior = localToWorldSpotOffset(
      this.worldPos.x,
      this.worldPos.z,
      this.wallYaw,
      this.config.placement.interiorLocal.x,
      this.config.placement.interiorLocal.z
    )
    this.interiorAnchor = {
      x: Number.isFinite(spec.interiorAnchor?.x)
        ? spec.interiorAnchor.x
        : fallbackInterior.x,
      y: Number.isFinite(spec.interiorAnchor?.y)
        ? spec.interiorAnchor.y
        : this.config.cameraPose.playerOffsetY || 0,
      z: Number.isFinite(spec.interiorAnchor?.z)
        ? spec.interiorAnchor.z
        : fallbackInterior.z,
    }

    // Runtime stealth & animation state
    this.isOccupied = false
    this.timeHiddenSec = 0
    this.exposure = 0
    this.spottedEntering = false
    this.compromised = false
    this.flashlightLeak = false
    this.warning = false
    this.reenterCooldownSec = 0
    this._openProgress = 0
    this._doorPulseTimer = 0
    this._swayPhase = ((this.row * 7 + this.col * 13) % 10) * 0.6
    this._swayAmp = 0
    this._flywheelAngle = 0
    this._colliderVersion = 1

    this.mesh = buildHidingSpotMesh({
      id: this.id,
      type: this.type,
      x: this.worldPos.x,
      y: this.worldPos.y,
      z: this.worldPos.z,
      wallYaw: this.wallYaw,
    })
  }

  getMesh() {
    return this.mesh
  }

  getColliderVersion() {
    return this._colliderVersion
  }

  getColliderSpecs() {
    const colSpec = this.config.placement?.colliderSpec
    if (!colSpec || !colSpec.blocksWhenEmpty) {
      return []
    }
    const worldCenter = localToWorldSpotOffset(
      this.worldPos.x,
      this.worldPos.z,
      this.wallYaw,
      colSpec.localX || 0,
      colSpec.localZ || 0
    )
    return [
      {
        id: `${this.id}:collider`,
        row: this.row,
        col: this.col,
        kind: colSpec.kind || 'obb',
        cx: worldCenter.x,
        cz: worldCenter.z,
        halfW: colSpec.halfW,
        halfD: colSpec.halfD,
        yaw: this.wallYaw,
        // Disable solid collider while player is concealed inside this spot
        enabled: !this.isOccupied,
        allowCorridorBlock: false,
      },
    ]
  }

  getInteractionAnchor() {
    return { ...this.entryAnchor }
  }

  getDistanceToPlayer(playerWorldPos) {
    if (!playerWorldPos) return Infinity
    const dx = playerWorldPos.x - this.entryAnchor.x
    const dz = playerWorldPos.z - this.entryAnchor.z
    const distEntry = Math.hypot(dx, dz)
    const dxCenter = playerWorldPos.x - this.worldPos.x
    const dzCenter = playerWorldPos.z - this.worldPos.z
    const distCenter = Math.hypot(dxCenter, dzCenter)
    return Math.min(distEntry, distCenter)
  }

  canPlayerInteract(playerWorldPos, playerGridCell = null, options = null) {
    if (this.isDisposed || !playerWorldPos) return false
    void playerGridCell
    if (this.isOccupied) return true
    if (this.reenterCooldownSec > 0) return false

    const triggerRadius =
      this.config.triggerRadius || DEFAULT_HIDING_INTERACT_RANGE
    const dist = this.getDistanceToPlayer(playerWorldPos)
    if (dist > triggerRadius) return false

    if (!options?.skipLineOfSight && this.maze) {
      if (
        !hasLineOfSightInMaze(
          playerWorldPos.x,
          playerWorldPos.z,
          this.entryAnchor.x,
          this.entryAnchor.z,
          this.maze
        )
      ) {
        return false
      }
    }
    return true
  }

  getInteractableDescriptor() {
    return {
      kind: 'hiding_spot',
      id: this.id,
      type: this.type,
      label: this.isOccupied
        ? this.config.exitPrompt
        : this.config.interactPrompt,
      shortLabel: this.isOccupied ? 'Exit' : 'Hide',
      isOccupied: this.isOccupied,
    }
  }

  getCameraPose() {
    const pose = this.config.cameraPose
    return {
      active: true,
      spotId: this.id,
      spotType: this.type,
      eyeHeight: pose.eyeHeight,
      playerOffsetY: pose.playerOffsetY || 0,
      followDistance: pose.tpFollowDistance,
      followHeight: pose.tpFollowHeight,
      freeLookTargetHeight: pose.freeLookTargetHeight,
      centerYaw: this.wallYaw,
      yawHalfArc: pose.yawHalfArc,
      minPitch: pose.minPitch,
      maxPitch: pose.maxPitch,
    }
  }

  enter({ spottedEntering = false } = {}) {
    if (this.isDisposed || this.isOccupied) {
      return { entered: false }
    }
    this.isOccupied = true
    this.timeHiddenSec = 0
    this.spottedEntering = Boolean(spottedEntering)
    this.compromised = Boolean(spottedEntering)
    this.exposure = this.compromised ? 1.0 : 0
    this.flashlightLeak = false
    this.warning = this.compromised
    this._doorPulseTimer = 0.65
    this._swayAmp = 1.0
    this._colliderVersion += 1

    return {
      entered: true,
      spotId: this.id,
      spotType: this.type,
      interiorAnchor: { ...this.interiorAnchor },
      outwardYaw: this.wallYaw,
      hidePlayerMesh: Boolean(this.config.hidePlayerMesh),
      soundRange: this.config.entrySoundRange,
      spottedEntering: this.spottedEntering,
      subtitle: this.config.subtitles.enter,
    }
  }

  exit({ forced = false, cooldownSec = 0.35 } = {}) {
    if (!this.isOccupied) {
      return { exited: false }
    }
    this.isOccupied = false
    this.timeHiddenSec = 0
    this.exposure = 0
    this.spottedEntering = false
    this.compromised = false
    this.flashlightLeak = false
    this.warning = false
    this.reenterCooldownSec = Math.max(0, cooldownSec)
    this._doorPulseTimer = 0.7
    this._swayAmp = 1.15
    this._colliderVersion += 1

    return {
      exited: true,
      forced: Boolean(forced),
      spotId: this.id,
      spotType: this.type,
      exitAnchor: { ...this.entryAnchor },
      outwardYaw: this.wallYaw,
      soundRange: forced
        ? this.config.ejectSoundRange
        : this.config.exitSoundRange,
      subtitle: forced
        ? this.config.subtitles.eject
        : this.config.subtitles.exit,
    }
  }

  resetState() {
    this.isOccupied = false
    this.timeHiddenSec = 0
    this.exposure = 0
    this.spottedEntering = false
    this.compromised = false
    this.flashlightLeak = false
    this.warning = false
    this.reenterCooldownSec = 0
    this._openProgress = 0
    this._doorPulseTimer = 0
    this._swayAmp = 0
    this._colliderVersion += 1
    updateHidingSpotVisualState(this.mesh, {
      openProgress: 0,
      occupied: false,
      warning: false,
      compromised: false,
    })
  }

  syncQuality(qualityPreset) {
    return syncHidingSpotQuality(this.mesh, qualityPreset)
  }

  update(delta = 0, context = null) {
    if (this.isDisposed || !Number.isFinite(delta) || delta <= 0) {
      return { ejectRequired: false, warningEntered: false }
    }

    if (this.reenterCooldownSec > 0) {
      this.reenterCooldownSec = Math.max(0, this.reenterCooldownSec - delta)
    }

    const playerPos = context?.playerWorldPos
    if (
      playerPos &&
      !this.isOccupied &&
      this._doorPulseTimer <= 0 &&
      Math.abs(this._openProgress) < 1e-3 &&
      this._swayAmp <= 1e-4
    ) {
      const dx = this.worldPos.x - playerPos.x
      const dz = this.worldPos.z - playerPos.z
      if (dx * dx + dz * dz > 36 * 36) {
        return { ejectRequired: false, warningEntered: false }
      }
    }

    const reducedMotion = Boolean(context?.reducedMotion)
    const speedRate = reducedMotion ? 16 : 6.5

    if (this._doorPulseTimer > 0) {
      this._doorPulseTimer = Math.max(0, this._doorPulseTimer - delta)
    }
    this._swayPhase = (this._swayPhase + delta * 2.4) % (Math.PI * 2)
    this._swayAmp = Math.max(0, this._swayAmp - delta * 1.45)
    this._flywheelAngle = (this._flywheelAngle + delta * 3.8) % (Math.PI * 2)

    // Hatch stays propped slightly open for peep slit when occupied, door cracks when entering/exiting
    const targetOpen =
      this.type === HIDING_SPOT_TYPES.FLOOR_HATCH
        ? this.isOccupied
          ? 0.28
          : this._doorPulseTimer > 0
            ? 0.92
            : 0
        : this.type === HIDING_SPOT_TYPES.PIPE_CRAWLSPACE ||
            this.type === HIDING_SPOT_TYPES.STORAGE_SHELVES
          ? this.isOccupied
            ? 0.22
            : this._doorPulseTimer > 0
              ? 0.85
              : 0
          : this._doorPulseTimer > 0
            ? 0.92
            : this.isOccupied &&
                this.type === HIDING_SPOT_TYPES.HEAVY_INDUSTRIAL_CURTAINS
              ? 0.14
              : 0

    const alpha = 1 - Math.exp(-speedRate * delta)
    this._openProgress += (targetOpen - this._openProgress) * alpha

    let warningEntered = false
    let ejectRequired = false

    if (this.isOccupied) {
      this.timeHiddenSec += delta
      const maxDur = Math.max(5, this.config.maxDurationSec || 22)
      const timeRatio = this.timeHiddenSec / maxDur

      const flashlightOn = Boolean(context?.flashlightActive)
      this.flashlightLeak = flashlightOn

      if (flashlightOn) {
        this.exposure = Math.min(
          1,
          this.exposure + (this.config.flashlightExposureRate || 0.45) * delta
        )
      } else {
        // Slowly calm flashlight/bump exposure when hidden quietly below warning threshold
        const baselineExposure =
          timeRatio > this.config.warningRatio
            ? (timeRatio - this.config.warningRatio) /
              Math.max(0.05, 1 - this.config.warningRatio)
            : 0
        if (this.exposure > baselineExposure) {
          this.exposure = Math.max(baselineExposure, this.exposure - delta * 0.25)
        } else {
          this.exposure = baselineExposure
        }
      }

      if (this.spottedEntering || this.exposure >= 1.0) {
        this.compromised = true
      }

      const prevWarning = this.warning
      this.warning = Boolean(
        this.compromised ||
          this.flashlightLeak ||
          timeRatio >= (this.config.warningRatio || 0.72)
      )
      if (!prevWarning && this.warning) {
        warningEntered = true
      }

      if (this.timeHiddenSec >= maxDur) {
        this.compromised = true
        this.exposure = 1.0
        ejectRequired = true
      }
    }

    updateHidingSpotVisualState(this.mesh, {
      openProgress: this._openProgress,
      occupied: this.isOccupied,
      warning: this.warning,
      compromised: this.compromised,
      swayPhase: this._swayPhase,
      swayAmp: this._swayAmp,
      flywheelAngle: this._flywheelAngle,
      reducedMotion,
    })

    return {
      ejectRequired,
      warningEntered,
    }
  }

  getStatusSnapshot() {
    const maxDur = Math.max(5, this.config.maxDurationSec || 22)
    return {
      spotId: this.id,
      spotType: this.type,
      label: this.config.label,
      shortLabel: this.config.shortLabel,
      isOccupied: this.isOccupied,
      timeHiddenSec: this.timeHiddenSec,
      maxDurationSec: maxDur,
      timeRemainingSec: Math.max(0, maxDur - this.timeHiddenSec),
      exposure: this.exposure,
      warning: this.warning,
      flashlightLeak: this.flashlightLeak,
      compromised: this.compromised,
      spottedEntering: this.spottedEntering,
      concealment: this.config.concealment,
      noiseDamping: this.config.noiseDamping,
      closeDiscoveryRadius: this.config.closeDiscoveryRadius,
      flashlightDetectRange: this.config.flashlightDetectRange,
    }
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.isOccupied = false
    disposeHidingSpotMesh(this.mesh)
    this.mesh = null
    return true
  }
}
