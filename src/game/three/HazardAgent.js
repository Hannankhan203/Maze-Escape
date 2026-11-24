import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { buildHazardMesh, updateHazardVisualState, disposeHazardMesh } from './buildHazards.js'
import { gridToWorld } from '../world/worldCoords.js'

export const HAZARD_STATES = {
  DORMANT: 'dormant',
  WARNING: 'warning',
  ACTIVE: 'active',
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
}

/**
 * ReusableHazardAgent for managing environmental hazards (spikes, pressure plates, electric grids) in 3D maze.
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

    this.initialTimer = Number.isFinite(spec.initialTimer) ? spec.initialTimer : 0
    this.state = HAZARD_STATES.DORMANT
    this.timer = 0
    this.cooldownRemaining = 0
    this.hasDealtDamage = false
    this.isPermanentlyCollapsed = false
    this._applyInitialTimerPhase()

    this.mesh = buildHazardMesh({ type: this.type, id: this.id })
    if (this.maze && Number.isFinite(this.row) && Number.isFinite(this.col)) {
      const pos = gridToWorld(this.row, this.col, this.maze)
      if (pos && this.mesh) {
        this.mesh.position.set(pos.x, 0, pos.z)
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

    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE || this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE || this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES || this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
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

  resetState() {
    this._applyInitialTimerPhase()
    const progress =
      this.config.warningDuration > 0
        ? this.timer / this.config.warningDuration
        : 0
    updateHazardVisualState(this.mesh, this.state, progress)
  }

  update(delta = 0, playerContext = null) {
    if (this.isDisposed || delta <= 0 || this.isPermanentlyCollapsed) return null

    this.timer += delta
    let hit = null

    const playerCell = playerContext?.playerGridCell
    const isPlayerOnTile =
      playerCell && playerCell.row === this.row && playerCell.col === this.col
    let isPlayerInImpactArea = isPlayerOnTile
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

    if (this.state === HAZARD_STATES.DORMANT) {
      this.hasDealtDamage = false
      if (this.type === HAZARD_TYPES.PRESSURE_PLATE) {
        if (this.cooldownRemaining > 0) {
          this.cooldownRemaining = Math.max(0, this.cooldownRemaining - delta)
        } else if (isPlayerOnTile) {
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
        if (this.type === HAZARD_TYPES.CEILING_COLLAPSE || this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE || this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES || this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
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

    const progress =
      this.config.warningDuration > 0
        ? Math.min(1, this.timer / this.config.warningDuration)
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
    return true
  }
}
