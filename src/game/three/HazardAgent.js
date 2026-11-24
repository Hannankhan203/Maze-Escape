import { HAZARD_TYPES, resolveElectricalMount } from '../generation/hazardPlacement.js'
import { buildHazardMesh, updateHazardVisualState, disposeHazardMesh } from './buildHazards.js'
import { gridToWorld } from '../world/worldCoords.js'

export const HAZARD_STATES = {
  DORMANT: 'dormant',
  WARNING: 'warning',
  ACTIVE: 'active',
  DISABLED: 'disabled',
}

export const HAZARD_CONFIG = {
  [HAZARD_TYPES.FLOOR_SPIKES]: {
    dormantDuration: 3.5,
    warningDuration: 1.0,
    activeDuration: 1.2,
    cooldownDuration: 2.0,
    damage: 25,
  },
  [HAZARD_TYPES.PRESSURE_PLATE]: {
    dormantDuration: 0,
    warningDuration: 0.8,
    activeDuration: 1.0,
    cooldownDuration: 3.0,
    damage: 25,
  },
  [HAZARD_TYPES.ELECTRIC_GRID]: {
    dormantDuration: 2.5,
    warningDuration: 1.2,
    activeDuration: 1.5,
    cooldownDuration: 2.0,
    damage: 30,
  },
  [HAZARD_TYPES.CEILING_COLLAPSE]: {
    dormantDuration: 4.5,
    warningDuration: 1.5,
    activeDuration: 1.2,
    cooldownDuration: 0,
    damage: 35,
  },
  [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE]: {
    dormantDuration: 4.0,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
  },
  [HAZARD_TYPES.FALLING_PIPES_FIXTURES]: {
    dormantDuration: 4.2,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
  },
  [HAZARD_TYPES.STEAM_PIPE_BURST]: {
    dormantDuration: 4.5,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
  },
  [HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]: {
    dormantDuration: 0,
    warningDuration: 1.3,
    activeDuration: 0.9,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.2,
    dangerRadius: 1.05,
  },
}

/**
 * ReusableHazardAgent for managing environmental hazards in 3D maze.
 */
export class HazardAgent {
  constructor(spec = {}, maze = null) {
    this.id = spec.id || `hazard-${Math.random()}`
    this.type = spec.type || HAZARD_TYPES.FLOOR_SPIKES
    this.row = spec.row
    this.col = spec.col
    this.maze = maze
    this.isDisposed = false

    this.config = HAZARD_CONFIG[this.type] || {
      dormantDuration: 3.0,
      warningDuration: 1.0,
      activeDuration: 1.0,
      cooldownDuration: 2.0,
      damage: 25,
    }

    this.mountType = null
    this.wallSide = null
    this.wallYaw = 0
    this.localDischargeOffset = null
    this.dangerWorldPos = null
    this.worldPos = null
    this.dangerRadius = Number.isFinite(this.config.dangerRadius) ? this.config.dangerRadius : 0.85
    this.triggerRadius = Number.isFinite(this.config.triggerRadius) ? this.config.triggerRadius : 1.8

    if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      if (spec.mountType === 'wall' || spec.mountType === 'ceiling') {
        this.mountType = spec.mountType
        this.wallSide = spec.wallSide || null
        this.wallYaw = Number.isFinite(spec.wallYaw) ? spec.wallYaw : 0
        this.localDischargeOffset = spec.localDischargeOffset
          ? { ...spec.localDischargeOffset }
          : resolveElectricalMount(this.maze?.grid, this.row, this.col, null, this.wallSide)
              .localDischargeOffset
      } else {
        const resolved = resolveElectricalMount(
          this.maze?.grid,
          this.row,
          this.col,
          null,
          spec.wallSide || null
        )
        this.mountType = resolved.mountType
        this.wallSide = resolved.wallSide
        this.wallYaw = resolved.wallYaw
        this.localDischargeOffset = resolved.localDischargeOffset
      }
    }

    this.initialTimer = Number.isFinite(spec.initialTimer) ? spec.initialTimer : 0
    this.state = HAZARD_STATES.DORMANT
    this.timer = 0
    this.cooldownRemaining = 0
    this.hasDealtDamage = false
    this.isPermanentlyCollapsed = false
    this.isDisabled = false
    this._applyInitialTimerPhase()

    this.mesh = buildHazardMesh({
      type: this.type,
      id: this.id,
      mountType: this.mountType,
      wallSide: this.wallSide,
      wallYaw: this.wallYaw,
    })
    if (this.maze && Number.isFinite(this.row) && Number.isFinite(this.col)) {
      const pos = gridToWorld(this.row, this.col, this.maze)
      if (pos && this.mesh) {
        this.mesh.position.set(pos.x, 0, pos.z)
        if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING && this.localDischargeOffset) {
          this.dangerWorldPos = {
            x: pos.x + this.localDischargeOffset.x,
            y: this.localDischargeOffset.y,
            z: pos.z + this.localDischargeOffset.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
        } else {
          this.worldPos = { x: pos.x, y: 0.5, z: pos.z }
        }
      }
    }
    updateHazardVisualState(this.mesh, this.state, 0)
  }

  _applyInitialTimerPhase() {
    this.state = HAZARD_STATES.DORMANT
    this.timer = this.initialTimer
    this.cooldownRemaining = 0
    this.hasDealtDamage = false
    this.isPermanentlyCollapsed = false
    this.isDisabled = false

    if (
      this.type === HAZARD_TYPES.CEILING_COLLAPSE ||
      this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE ||
      this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES ||
      this.type === HAZARD_TYPES.STEAM_PIPE_BURST ||
      this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING
    ) {
      this.timer = 0
    } else if (this.type !== HAZARD_TYPES.PRESSURE_PLATE && Number.isFinite(this.initialTimer)) {
      const dormDur = this.config.dormantDuration
      const warnDur = this.config.warningDuration
      const actDur = this.config.activeDuration
      const totalCycle = dormDur + warnDur + actDur

      const t = ((this.timer % (totalCycle > 0 ? totalCycle : 1)) + (totalCycle > 0 ? totalCycle : 1)) % (totalCycle > 0 ? totalCycle : 1)
      if (t < dormDur) {
        this.state = HAZARD_STATES.DORMANT
        this.timer = t
      } else if (t < dormDur + warnDur) {
        this.state = HAZARD_STATES.WARNING
        this.timer = t - dormDur
      } else {
        this.state = HAZARD_STATES.ACTIVE
        this.timer = t - (dormDur + warnDur)
      }
    } else if (this.type === HAZARD_TYPES.PRESSURE_PLATE) {
      this.timer = 0
    }
  }

  getMesh() {
    return this.mesh
  }

  getState() {
    return this.state
  }

  getDangerArea() {
    if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        mountType: this.mountType,
        wallSide: this.wallSide,
      }
    }
    if (this.worldPos) {
      return {
        center: { ...this.worldPos },
        radius: this.dangerRadius,
        mountType: null,
        wallSide: null,
      }
    }
    return null
  }

  resetState() {
    this._applyInitialTimerPhase()
    if (this.mesh?.userData) {
      this.mesh.userData.isPermanentlyCollapsed = false
    }
    const progress =
      this.config.warningDuration > 0
        ? this.timer / this.config.warningDuration
        : 0
    updateHazardVisualState(this.mesh, this.state, progress)
  }

  update(delta = 0, playerContext = null) {
    if (
      this.isDisposed ||
      delta <= 0 ||
      this.isPermanentlyCollapsed ||
      this.isDisabled ||
      this.state === HAZARD_STATES.DISABLED
    ) {
      return null
    }

    this.timer += delta
    let hit = null

    const playerCell = playerContext?.playerGridCell
    const isPlayerOnTile =
      playerCell && playerCell.row === this.row && playerCell.col === this.col

    let isPlayerInImpactArea
    let distToDischarge = Infinity

    if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      // World-space danger area matching the visible wall/ceiling electrical discharge
      if (playerContext?.playerWorldPos && this.dangerWorldPos) {
        const dx = playerContext.playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerContext.playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea = distToDischarge <= this.dangerRadius
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else {
      isPlayerInImpactArea = Boolean(isPlayerOnTile)
      if (!isPlayerInImpactArea && playerContext?.playerWorldPos && this.maze && Number.isFinite(this.row) && Number.isFinite(this.col)) {
        const wPos = gridToWorld(this.row, this.col, this.maze)
        if (wPos) {
          const dx = playerContext.playerWorldPos.x - wPos.x
          const dz = playerContext.playerWorldPos.z - wPos.z
          if (Math.hypot(dx, dz) <= 0.85) {
            isPlayerInImpactArea = true
          }
        }
      }
    }

    if (this.state === HAZARD_STATES.DORMANT) {
      this.hasDealtDamage = false
      if (this.type === HAZARD_TYPES.PRESSURE_PLATE) {
        if (this.cooldownRemaining > 0) {
          this.cooldownRemaining = Math.max(0, this.cooldownRemaining - delta)
        } else if (isPlayerOnTile) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
        const isPlayerApproaching =
          playerContext?.playerWorldPos && this.dangerWorldPos
            ? distToDischarge <= this.triggerRadius
            : Boolean(isPlayerOnTile)
        if (isPlayerApproaching) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else if (this.type === HAZARD_TYPES.CEILING_COLLAPSE || this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE || this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES || this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
        let isPlayerClose = isPlayerInImpactArea
        if (!isPlayerClose && playerContext?.playerWorldPos && this.maze) {
          const wPos = gridToWorld(this.row, this.col, this.maze)
          if (wPos) {
            const dx = playerContext.playerWorldPos.x - wPos.x
            const dz = playerContext.playerWorldPos.z - wPos.z
            if (Math.hypot(dx, dz) < 1.8) {
              isPlayerClose = true
            }
          }
        }
        if (isPlayerClose || this.timer >= this.config.dormantDuration) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else {
        if (this.timer >= this.config.dormantDuration) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      }
    }

    if (this.state === HAZARD_STATES.WARNING) {
      if (this.timer >= this.config.warningDuration) {
        this.state = HAZARD_STATES.ACTIVE
        this.timer = 0
        this.hasDealtDamage = false
      }
    }

    if (this.state === HAZARD_STATES.ACTIVE) {
      if (isPlayerInImpactArea && !this.hasDealtDamage) {
        this.hasDealtDamage = true
        hit = {
          hazardId: this.id,
          type: this.type,
          damage: this.config.damage,
          row: this.row,
          col: this.col,
        }
      }

      if (this.timer >= this.config.activeDuration) {
        if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
          this.isPermanentlyCollapsed = true
          this.isDisabled = true
          this.state = HAZARD_STATES.DISABLED
          this.timer = 0
          if (this.mesh?.userData) {
            this.mesh.userData.isPermanentlyCollapsed = true
          }
          updateHazardVisualState(this.mesh, HAZARD_STATES.DISABLED, 1)
          return hit
        } else if (this.type === HAZARD_TYPES.CEILING_COLLAPSE || this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE || this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES || this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
          this.isPermanentlyCollapsed = true
          this.state = HAZARD_STATES.ACTIVE
        } else {
          this.state = HAZARD_STATES.DORMANT
          this.timer = 0
          this.hasDealtDamage = false
          if (this.type === HAZARD_TYPES.PRESSURE_PLATE) {
            this.cooldownRemaining = this.config.cooldownDuration || 3.0
          }
        }
      }
    }

    const phaseDuration =
      this.state === HAZARD_STATES.ACTIVE
        ? this.config.activeDuration
        : this.config.warningDuration
    const progress =
      phaseDuration > 0
        ? Math.min(1, this.timer / phaseDuration)
        : 0
    updateHazardVisualState(this.mesh, this.state, progress)

    return hit
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    if (this.mesh) {
      disposeHazardMesh(this.mesh)
      this.mesh = null
    }
    this.maze = null
    this.worldPos = null
    this.dangerWorldPos = null
    this.localDischargeOffset = null
    return true
  }
}
