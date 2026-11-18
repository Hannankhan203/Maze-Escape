import { gridToWorld, worldToGrid } from '../world/worldCoords.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { buildHazardMesh, disposeHazardMesh, updateHazardVisualState } from './buildHazards.js'

export const HAZARD_STATES = {
  DORMANT: 'dormant',
  WARNING: 'warning',
  ACTIVE: 'active',
}

export const HAZARD_CONFIG = {
  [HAZARD_TYPES.FLOOR_SPIKES]: {
    dormantDuration: 2.2,
    warningDuration: 0.8,
    activeDuration: 1.2,
    damage: 20,
    triggerRadius: 0.7,
  },
  [HAZARD_TYPES.PRESSURE_PLATE]: {
    dormantDuration: 0.0, // triggered strictly on player step
    warningDuration: 0.4,
    activeDuration: 0.9,
    cooldownDuration: 1.5,
    damage: 15,
    triggerRadius: 0.65,
  },
  [HAZARD_TYPES.ELECTRIC_GRID]: {
    dormantDuration: 2.5,
    warningDuration: 1.0,
    activeDuration: 1.5,
    damage: 25,
    triggerRadius: 0.75,
  },
}

/**
 * Autonomous hazard agent representing an environmental trap in the 3D maze.
 */
export class HazardAgent {
  constructor(hazardData = {}, maze = null, options = {}) {
    this.id = hazardData.id || `hazard-${hazardData.type || 'trap'}-${hazardData.row ?? 0}-${hazardData.col ?? 0}`
    this.type = hazardData.type || HAZARD_TYPES.FLOOR_SPIKES
    this.row = hazardData.row
    this.col = hazardData.col
    this.maze = maze
    this.isDisposed = false

    const baseConfig = HAZARD_CONFIG[this.type] || HAZARD_CONFIG[HAZARD_TYPES.FLOOR_SPIKES]
    this.config = {
      ...baseConfig,
      ...(hazardData?.config || {}),
      ...(options?.config || {}),
    }

    this.initialTimer = Number.isFinite(hazardData.initialTimer)
      ? Math.max(0, hazardData.initialTimer)
      : 0

    this.state = HAZARD_STATES.DORMANT
    this.timer = this.type === HAZARD_TYPES.PRESSURE_PLATE ? 0 : this.initialTimer
    this.cooldownTimer = 0
    this.hasDealtDamageThisActivation = false

    const pos = gridToWorld(this.row, this.col, this.maze)
    this.worldPos = pos ? { x: pos.x, y: 0, z: pos.z } : { x: 0, y: 0, z: 0 }

    this.mesh = buildHazardMesh({
      id: this.id,
      type: this.type,
    })

    if (this.mesh) {
      this.mesh.position.set(this.worldPos.x, 0, this.worldPos.z)
      updateHazardVisualState(this.mesh, this.state, 0)
    }
  }

  getMesh() {
    return this.mesh
  }

  getState() {
    return this.state
  }

  resetState() {
    if (this.isDisposed) return
    this.state = HAZARD_STATES.DORMANT
    this.timer = this.type === HAZARD_TYPES.PRESSURE_PLATE ? 0 : this.initialTimer
    this.cooldownTimer = 0
    this.hasDealtDamageThisActivation = false
    if (this.mesh) {
      updateHazardVisualState(this.mesh, this.state, 0)
    }
  }

  _isPlayerInZone(playerContext) {
    if (!playerContext?.playerWorldPos) return false
    const px = playerContext.playerWorldPos.x
    const pz = playerContext.playerWorldPos.z
    const dist = Math.hypot(px - this.worldPos.x, pz - this.worldPos.z)

    const playerCell =
      playerContext.playerGridCell ||
      (this.maze ? worldToGrid(px, pz, this.maze) : null)
    const isOnSameTile = Boolean(
      playerCell &&
        Number.isInteger(this.row) &&
        Number.isInteger(this.col) &&
        playerCell.row === this.row &&
        playerCell.col === this.col
    )

    return isOnSameTile || dist <= this.config.triggerRadius
  }

  update(delta = 0, playerContext = null) {
    if (this.isDisposed || !Number.isFinite(delta) || delta <= 0) {
      return null
    }

    const isPressurePlate = this.type === HAZARD_TYPES.PRESSURE_PLATE
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - delta)
    }

    let stateDuration = this.config.dormantDuration

    if (isPressurePlate && this.state === HAZARD_STATES.DORMANT) {
      // Pressure plate only activates when stepped on after cooldown expires
      this.timer = 0
      stateDuration = 0
      if (this.cooldownTimer <= 0 && this._isPlayerInZone(playerContext)) {
        this.state = HAZARD_STATES.WARNING
        this.timer = 0
        this.hasDealtDamageThisActivation = false
        stateDuration = this.config.warningDuration
      }
    } else {
      this.timer += delta
      let guard = 0
      while (guard < 4) {
        guard += 1
        if (this.state === HAZARD_STATES.DORMANT) {
          if (isPressurePlate) {
            this.timer = 0
            stateDuration = 0
            break
          }
          stateDuration = this.config.dormantDuration
          if (this.timer >= stateDuration) {
            this.timer -= stateDuration
            this.state = HAZARD_STATES.WARNING
            this.hasDealtDamageThisActivation = false
            stateDuration = this.config.warningDuration
            continue
          }
          break
        } else if (this.state === HAZARD_STATES.WARNING) {
          stateDuration = this.config.warningDuration
          if (this.timer >= stateDuration) {
            this.timer -= stateDuration
            this.state = HAZARD_STATES.ACTIVE
            stateDuration = this.config.activeDuration
            continue
          }
          break
        } else if (this.state === HAZARD_STATES.ACTIVE) {
          stateDuration = this.config.activeDuration
          if (this.timer >= stateDuration) {
            this.timer -= stateDuration
            this.state = HAZARD_STATES.DORMANT
            this.hasDealtDamageThisActivation = false
            if (isPressurePlate) {
              this.timer = 0
              this.cooldownTimer = Math.max(0, Number(this.config.cooldownDuration) || 0)
              stateDuration = 0
              break
            }
            stateDuration = this.config.dormantDuration
            continue
          }
          break
        } else {
          break
        }
      }
    }

    const progress = stateDuration > 0 ? Math.min(1, Math.max(0, this.timer / stateDuration)) : 0
    updateHazardVisualState(this.mesh, this.state, progress)

    let hazardHit = null

    // Check proximity/collision when active
    if (
      this.state === HAZARD_STATES.ACTIVE &&
      !this.hasDealtDamageThisActivation &&
      this._isPlayerInZone(playerContext)
    ) {
      this.hasDealtDamageThisActivation = true
      hazardHit = {
        hazardId: this.id,
        type: this.type,
        damage: this.config.damage,
      }
    }

    return hazardHit
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
