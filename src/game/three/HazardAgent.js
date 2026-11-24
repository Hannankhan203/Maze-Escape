import {
  HAZARD_TYPES,
  resolveElectricalMount,
  resolveFloorGrateOrientation,
  resolveWallCollapseMount,
  resolveWaterTankMount,
  resolveSuspendedMachineryMount,
  resolveVentilationDuctMount,
} from '../generation/hazardPlacement.js'
import { buildHazardMesh, updateHazardVisualState, disposeHazardMesh } from './buildHazards.js'
import { gridToWorld } from '../world/worldCoords.js'

export const HAZARD_STATES = {
  DORMANT: 'dormant',
  WARNING: 'warning',
  ACTIVE: 'active',
  DISABLED: 'disabled',
}

export const HAZARD_CONFIG = {
  [HAZARD_TYPES.CEILING_COLLAPSE]: {
    dormantDuration: 0,
    warningDuration: 1.5,
    activeDuration: 1.2,
    cooldownDuration: 0,
    damage: 35,
  },
  [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE]: {
    dormantDuration: 0,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
  },
  [HAZARD_TYPES.FALLING_PIPES_FIXTURES]: {
    dormantDuration: 0,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
  },
  [HAZARD_TYPES.STEAM_PIPE_BURST]: {
    dormantDuration: 0,
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
  [HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]: {
    dormantDuration: 0,
    warningDuration: 0.95,
    activeDuration: 0.85,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 1.25,
    dangerRadius: 1.15,
  },
  [HAZARD_TYPES.WALL_COLLAPSE]: {
    dormantDuration: 0,
    warningDuration: 1.4,
    activeDuration: 0.95,
    cooldownDuration: 0,
    damage: 35,
    triggerRadius: 2.35,
    dangerRadius: 1.15,
  },
  [HAZARD_TYPES.FALLING_WATER_TANK]: {
    dormantDuration: 0,
    warningDuration: 1.45,
    activeDuration: 1.35,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.4,
    dangerRadius: 1.15,
    surgeHalfWidth: 1.05,
    surgeSpeedMultiplier: 0.62,
    surgeSlowdownDuration: 1.8,
  },
  [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]: {
    dormantDuration: 0,
    warningDuration: 1.5,
    activeDuration: 1.05,
    cooldownDuration: 0,
    damage: 40,
    triggerRadius: 2.5,
    dangerRadius: 1.25,
  },
  [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]: {
    dormantDuration: 0,
    warningDuration: 1.4,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 35,
    triggerRadius: 2.45,
    dangerRadius: 1.2,
    ductHalfWidth: 0.88,
    ductMinLocalZ: -0.58,
    ductMaxLocalZ: 1.68,
  },
}

/**
 * ReusableHazardAgent for managing environmental hazards in 3D maze.
 */
export class HazardAgent {
  constructor(spec = {}, maze = null) {
    if (!spec?.type || !Object.prototype.hasOwnProperty.call(HAZARD_CONFIG, spec.type)) {
      throw new Error(`Unsupported hazard type: ${spec?.type}`)
    }
    this.id = spec.id || `hazard-${Math.random()}`
    this.type = spec.type
    this.row = spec.row
    this.col = spec.col
    this.maze = maze
    this.isDisposed = false

    this.config = HAZARD_CONFIG[this.type]

    this.mountType = null
    this.wallSide = null
    this.wallRow = null
    this.wallCol = null
    this.isBoundaryWall = false
    this.wallYaw = 0
    this.collapseDir = null
    this.flowSide = null
    this.flowDir = null
    this.tankYaw = 0
    this.surgeLength = 2.55
    this.surgeHalfWidth = 1.05
    this.tankRestY = 2.48
    this.ceilingAnchorY = 3.58
    this.swingSide = null
    this.swingDir = null
    this.machineryYaw = 0
    this.machineryRestY = 2.42
    this.dropSide = null
    this.dropDir = null
    this.ductYaw = 0
    this.ductRestY = 3.18
    this.originWorldPos = null
    this.corridorAxis = null
    this.grateYaw = 0
    this.floorY = 0
    this.localDischargeOffset = null
    this.dangerWorldPos = null
    this.worldPos = null
    this.dangerRadius = Number.isFinite(this.config.dangerRadius) ? this.config.dangerRadius : 0.85
    this.triggerRadius = Number.isFinite(this.config.triggerRadius) ? this.config.triggerRadius : 1.8
    this.lastMovementEffect = null
    this._movementEffectOut = {
      speedMultiplier: 1,
      duration: 0,
      sourceType: this.type,
      hazardId: this.id,
    }

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
    } else if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      if (spec.corridorAxis === 'ns' || spec.corridorAxis === 'ew') {
        this.corridorAxis = spec.corridorAxis
        this.grateYaw = Number.isFinite(spec.grateYaw)
          ? spec.grateYaw
          : spec.corridorAxis === 'ew'
            ? Math.PI * 0.5
            : 0
        this.floorY = Number.isFinite(spec.floorY) ? spec.floorY : 0
      } else {
        const resolved = resolveFloorGrateOrientation(this.maze?.grid, this.row, this.col)
        this.corridorAxis = resolved.corridorAxis
        this.grateYaw = resolved.grateYaw
        this.floorY = resolved.floorY
      }
    } else if (this.type === HAZARD_TYPES.WALL_COLLAPSE) {
      const resolved = resolveWallCollapseMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.wallSide || null
      )
      if (spec.wallSide && spec.localImpactOffset && spec.collapseDir) {
        this.wallSide = spec.wallSide
        this.wallRow = Number.isInteger(spec.wallRow) ? spec.wallRow : resolved?.wallRow ?? null
        this.wallCol = Number.isInteger(spec.wallCol) ? spec.wallCol : resolved?.wallCol ?? null
        this.isBoundaryWall =
          spec.isBoundaryWall !== undefined
            ? Boolean(spec.isBoundaryWall)
            : Boolean(resolved?.isBoundaryWall)
        this.wallYaw = Number.isFinite(spec.wallYaw) ? spec.wallYaw : resolved?.wallYaw ?? 0
        this.collapseDir = { ...spec.collapseDir }
        this.localDischargeOffset = { ...spec.localImpactOffset }
      } else if (resolved) {
        this.wallSide = resolved.wallSide
        this.wallRow = resolved.wallRow
        this.wallCol = resolved.wallCol
        this.isBoundaryWall = resolved.isBoundaryWall
        this.wallYaw = resolved.wallYaw
        this.collapseDir = { ...resolved.collapseDir }
        this.localDischargeOffset = { ...resolved.localImpactOffset }
      } else {
        this.wallSide = 'north'
        this.wallYaw = 0
        this.collapseDir = { x: 0, z: 1 }
        this.localDischargeOffset = { x: 0, y: 1.0, z: -1.05 }
      }
    } else if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
      const resolved = resolveWaterTankMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.flowSide || null
      )
      this.mountType = spec.mountType || resolved.mountType
      this.wallSide = spec.wallSide !== undefined ? spec.wallSide : resolved.wallSide
      this.wallRow = Number.isInteger(spec.wallRow) ? spec.wallRow : resolved.wallRow
      this.wallCol = Number.isInteger(spec.wallCol) ? spec.wallCol : resolved.wallCol
      this.flowSide = spec.flowSide || resolved.flowSide
      this.tankYaw = Number.isFinite(spec.tankYaw) ? spec.tankYaw : resolved.tankYaw
      this.flowDir = spec.flowDir ? { ...spec.flowDir } : { ...resolved.flowDir }
      this.surgeLength = Number.isFinite(spec.surgeLength) ? spec.surgeLength : resolved.surgeLength
      this.surgeHalfWidth = Number.isFinite(spec.surgeHalfWidth)
        ? spec.surgeHalfWidth
        : resolved.surgeHalfWidth
      this.tankRestY = Number.isFinite(spec.tankRestY) ? spec.tankRestY : resolved.tankRestY
      this.ceilingAnchorY = Number.isFinite(spec.ceilingAnchorY)
        ? spec.ceilingAnchorY
        : resolved.ceilingAnchorY
    } else if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
      const resolved = resolveSuspendedMachineryMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.swingSide || null
      )
      this.mountType = spec.mountType || resolved.mountType
      this.swingSide = spec.swingSide || resolved.swingSide
      this.machineryYaw = Number.isFinite(spec.machineryYaw)
        ? spec.machineryYaw
        : resolved.machineryYaw
      this.swingDir = spec.swingDir ? { ...spec.swingDir } : { ...resolved.swingDir }
      this.localDischargeOffset = spec.localImpactOffset
        ? { ...spec.localImpactOffset }
        : { ...resolved.localImpactOffset }
      this.machineryRestY = Number.isFinite(spec.machineryRestY)
        ? spec.machineryRestY
        : resolved.machineryRestY
      this.ceilingAnchorY = Number.isFinite(spec.ceilingAnchorY)
        ? spec.ceilingAnchorY
        : resolved.ceilingAnchorY
    } else if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
      const resolved = resolveVentilationDuctMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.dropSide || null
      )
      this.mountType = spec.mountType || resolved.mountType
      this.wallSide = spec.wallSide !== undefined ? spec.wallSide : resolved.wallSide
      this.wallRow = Number.isInteger(spec.wallRow) ? spec.wallRow : resolved.wallRow
      this.wallCol = Number.isInteger(spec.wallCol) ? spec.wallCol : resolved.wallCol
      this.dropSide = spec.dropSide || resolved.dropSide
      this.ductYaw = Number.isFinite(spec.ductYaw) ? spec.ductYaw : resolved.ductYaw
      this.dropDir = spec.dropDir ? { ...spec.dropDir } : { ...resolved.dropDir }
      this.localDischargeOffset = spec.localImpactOffset
        ? { ...spec.localImpactOffset }
        : { ...resolved.localImpactOffset }
      this.ductRestY = Number.isFinite(spec.ductRestY) ? spec.ductRestY : resolved.ductRestY
      this.ceilingAnchorY = Number.isFinite(spec.ceilingAnchorY)
        ? spec.ceilingAnchorY
        : resolved.ceilingAnchorY
    }

    this.state = HAZARD_STATES.DORMANT
    this.timer = 0
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
      tankYaw: this.tankYaw,
      surgeLength: this.surgeLength,
      surgeHalfWidth: this.surgeHalfWidth,
      tankRestY: this.tankRestY,
      machineryYaw: this.machineryYaw,
      machineryRestY: this.machineryRestY,
      ductYaw: this.ductYaw,
      ductRestY: this.ductRestY,
      ceilingAnchorY: this.ceilingAnchorY,
      corridorAxis: this.corridorAxis,
      grateYaw: this.grateYaw,
      floorY: this.floorY,
    })
    if (this.maze && Number.isFinite(this.row) && Number.isFinite(this.col)) {
      const pos = gridToWorld(this.row, this.col, this.maze)
      if (pos && this.mesh) {
        this.mesh.position.set(pos.x, 0, pos.z)
        if (
          (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING ||
            this.type === HAZARD_TYPES.WALL_COLLAPSE) &&
          this.localDischargeOffset
        ) {
          this.dangerWorldPos = {
            x: pos.x + this.localDischargeOffset.x,
            y: this.localDischargeOffset.y,
            z: pos.z + this.localDischargeOffset.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
        } else if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
          this.dangerWorldPos = { x: pos.x, y: this.floorY, z: pos.z }
          this.worldPos = { x: pos.x, y: 0.05, z: pos.z }
        } else if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
          this.dangerWorldPos = { x: pos.x, y: 0.45, z: pos.z }
          this.worldPos = { x: pos.x, y: 1.25, z: pos.z }
        } else if (
          this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY ||
          this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE
        ) {
          const fallbackZ =
            this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE ? 0.56 : 0.72
          const fallbackY =
            this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE ? 0.65 : 0.75
          const off = this.localDischargeOffset || { x: 0, y: fallbackY, z: fallbackZ }
          this.originWorldPos = { x: pos.x, y: 1.2, z: pos.z }
          this.dangerWorldPos = {
            x: pos.x + off.x,
            y: off.y,
            z: pos.z + off.z,
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
    this.timer = 0
    this.hasDealtDamage = false
    this.isPermanentlyCollapsed = false
    this.isDisabled = false
    this.lastMovementEffect = null
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
    if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        floorY: this.floorY,
        corridorAxis: this.corridorAxis,
        grateYaw: this.grateYaw,
      }
    }
    if (this.type === HAZARD_TYPES.WALL_COLLAPSE && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        isBoundaryWall: this.isBoundaryWall,
        collapseDir: this.collapseDir ? { ...this.collapseDir } : null,
      }
    }
    if (this.type === HAZARD_TYPES.FALLING_WATER_TANK && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        flowSide: this.flowSide,
        flowDir: this.flowDir ? { ...this.flowDir } : null,
        surgeLength: this.surgeLength,
        surgeHalfWidth: this.surgeHalfWidth,
        tankRestY: this.tankRestY,
        ceilingAnchorY: this.ceilingAnchorY,
      }
    }
    if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        origin: this.originWorldPos ? { ...this.originWorldPos } : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        swingSide: this.swingSide,
        swingDir: this.swingDir ? { ...this.swingDir } : null,
        machineryRestY: this.machineryRestY,
        ceilingAnchorY: this.ceilingAnchorY,
      }
    }
    if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        origin: this.originWorldPos ? { ...this.originWorldPos } : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        halfWidth: this.config.ductHalfWidth ?? 0.88,
        minLocalZ: this.config.ductMinLocalZ ?? -0.58,
        maxLocalZ: this.config.ductMaxLocalZ ?? 1.68,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        dropSide: this.dropSide,
        dropDir: this.dropDir ? { ...this.dropDir } : null,
        ductRestY: this.ductRestY,
        ceilingAnchorY: this.ceilingAnchorY,
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
    this.lastMovementEffect = null
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
    let isPlayerInWaterSurge = false
    let distToDischarge = Infinity
    let distToOrigin = Infinity
    let tankLocalX = Infinity
    let tankLocalZ = Infinity
    let ductLocalX = Infinity
    let ductLocalZ = Infinity

    if (
      this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING ||
      this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE ||
      this.type === HAZARD_TYPES.WALL_COLLAPSE
    ) {
      // Accurate world-space danger area matching the visible hazard envelope
      if (playerContext?.playerWorldPos && this.dangerWorldPos) {
        const dx = playerContext.playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerContext.playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea = distToDischarge <= this.dangerRadius
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
      if (playerContext?.playerWorldPos && this.dangerWorldPos) {
        const dx = playerContext.playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerContext.playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        const fx = this.flowDir ? this.flowDir.x : 0
        const fz = this.flowDir ? this.flowDir.z : 1
        tankLocalZ = dx * fx + dz * fz
        tankLocalX = dx * fz - dz * fx
        isPlayerInImpactArea = distToDischarge <= this.dangerRadius
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
      if (playerContext?.playerWorldPos && this.dangerWorldPos) {
        const dx = playerContext.playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerContext.playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        if (this.originWorldPos) {
          const ox = playerContext.playerWorldPos.x - this.originWorldPos.x
          const oz = playerContext.playerWorldPos.z - this.originWorldPos.z
          distToOrigin = Math.hypot(ox, oz)
        } else {
          distToOrigin = distToDischarge
        }
        isPlayerInImpactArea = distToDischarge <= this.dangerRadius
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
      if (playerContext?.playerWorldPos && this.dangerWorldPos) {
        const dx = playerContext.playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerContext.playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        const refX = this.originWorldPos ? this.originWorldPos.x : this.dangerWorldPos.x
        const refZ = this.originWorldPos ? this.originWorldPos.z : this.dangerWorldPos.z
        const ox = playerContext.playerWorldPos.x - refX
        const oz = playerContext.playerWorldPos.z - refZ
        distToOrigin = Math.hypot(ox, oz)
        const fx = this.dropDir ? this.dropDir.x : 0
        const fz = this.dropDir ? this.dropDir.z : 1
        ductLocalZ = ox * fx + oz * fz
        ductLocalX = ox * fz - oz * fx
        const halfW = this.config.ductHalfWidth ?? 0.88
        const minZ = this.config.ductMinLocalZ ?? -0.58
        const maxZ = this.config.ductMaxLocalZ ?? 1.68
        isPlayerInImpactArea =
          ductLocalZ >= minZ && ductLocalZ <= maxZ && Math.abs(ductLocalX) <= halfW
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
      if (
        this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING ||
        this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE ||
        this.type === HAZARD_TYPES.WALL_COLLAPSE ||
        this.type === HAZARD_TYPES.FALLING_WATER_TANK
      ) {
        const isPlayerApproaching =
          playerContext?.playerWorldPos && this.dangerWorldPos
            ? distToDischarge <= this.triggerRadius
            : Boolean(isPlayerOnTile)
        if (isPlayerApproaching) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else if (
        this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY ||
        this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE
      ) {
        const isPlayerApproaching =
          playerContext?.playerWorldPos && this.dangerWorldPos
            ? distToDischarge <= this.triggerRadius || distToOrigin <= this.triggerRadius
            : Boolean(isPlayerOnTile)
        if (isPlayerApproaching) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else if (
        this.type === HAZARD_TYPES.CEILING_COLLAPSE ||
        this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE ||
        this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES ||
        this.type === HAZARD_TYPES.STEAM_PIPE_BURST
      ) {
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
        if (isPlayerClose) {
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
      if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
        const activeProgress =
          this.config.activeDuration > 0
            ? Math.min(1, this.timer / this.config.activeDuration)
            : 1
        const surgeT = activeProgress <= 0.18 ? 0 : Math.min(1, (activeProgress - 0.18) / 0.82)
        if (surgeT > 0.01 && playerContext?.playerWorldPos && this.dangerWorldPos) {
          const reachEase = 1 - (1 - surgeT) * (1 - surgeT)
          const currentFrontZ = 0.45 + reachEase * (this.surgeLength - 0.45)
          if (
            tankLocalZ >= -0.58 &&
            tankLocalZ <= currentFrontZ &&
            Math.abs(tankLocalX) <= this.surgeHalfWidth
          ) {
            isPlayerInWaterSurge = true
            isPlayerInImpactArea = true
          }
        }
        if ((isPlayerInWaterSurge || (isPlayerInImpactArea && surgeT > 0.01)) && this._movementEffectOut) {
          this._movementEffectOut.speedMultiplier = this.config.surgeSpeedMultiplier || 0.62
          this._movementEffectOut.duration = this.config.surgeSlowdownDuration || 1.8
          this._movementEffectOut.sourceType = this.type
          this._movementEffectOut.hazardId = this.id
          this.lastMovementEffect = this._movementEffectOut
        }
      } else if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
        const activeProgress =
          this.config.activeDuration > 0
            ? Math.min(1, this.timer / this.config.activeDuration)
            : 1
        if (
          !isPlayerInImpactArea &&
          activeProgress < 0.45 &&
          playerContext?.playerWorldPos &&
          distToOrigin <= 0.95
        ) {
          isPlayerInImpactArea = true
        }
      } else if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
        const activeProgress =
          this.config.activeDuration > 0
            ? Math.min(1, this.timer / this.config.activeDuration)
            : 1
        if (
          !isPlayerInImpactArea &&
          activeProgress < 0.45 &&
          playerContext?.playerWorldPos &&
          ductLocalZ >= -0.95 &&
          ductLocalZ <= 1.15 &&
          Math.abs(ductLocalX) <= 0.75
        ) {
          isPlayerInImpactArea = true
        }
      }

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
        this.isPermanentlyCollapsed = true
        this.isDisabled = true
        this.state = HAZARD_STATES.DISABLED
        this.timer = 0
        this.lastMovementEffect = null
        if (this.mesh?.userData) {
          this.mesh.userData.isPermanentlyCollapsed = true
        }
        updateHazardVisualState(this.mesh, HAZARD_STATES.DISABLED, 1)
        return hit
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
    this.collapseDir = null
    this.flowDir = null
    this.swingDir = null
    this.dropDir = null
    this.originWorldPos = null
    this.lastMovementEffect = null
    this._movementEffectOut = null
    return true
  }
}
