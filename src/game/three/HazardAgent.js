import {
  HAZARD_TYPES,
  resolveCeilingCollapseMount,
  resolveRottenFurnitureMount,
  resolveFallingPipesMount,
  resolveSteamPipeMount,
  resolveElectricalMount,
  resolveFloorGrateOrientation,
  resolveWallCollapseMount,
  resolveWaterTankMount,
  resolveSuspendedMachineryMount,
  resolveVentilationDuctMount,
} from '../generation/hazardPlacement.js'
import { buildHazardMesh, updateHazardVisualState, disposeHazardMesh } from './buildHazards.js'
import { hasLineOfSightInMaze } from '../world/gridCollision.js'
import { gridToWorld } from '../world/worldCoords.js'

export const DEFAULT_HAZARD_INTERACT_RANGE = 2.2

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
    triggerRadius: 2.15,
    dangerRadius: 1.3,
    impactWindowEndProgress: 0.68,
  },
  [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE]: {
    dormantDuration: 0,
    warningDuration: 1.25,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.15,
    dangerRadius: 1.18,
    impactWindowEndProgress: 0.68,
  },
  [HAZARD_TYPES.FALLING_PIPES_FIXTURES]: {
    dormantDuration: 0,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.15,
    dangerRadius: 1.18,
    impactWindowEndProgress: 0.68,
  },
  [HAZARD_TYPES.STEAM_PIPE_BURST]: {
    dormantDuration: 0,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.15,
    dangerRadius: 1.18,
    impactWindowEndProgress: 0.72,
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
    this.cellWorldPos = null
    this.dangerRadius = Number.isFinite(this.config.dangerRadius) ? this.config.dangerRadius : 0.85
    this.triggerRadius = Number.isFinite(this.config.triggerRadius) ? this.config.triggerRadius : 1.8
    this.lastMovementEffect = null
    this._movementEffectOut = {
      speedMultiplier: 1,
      duration: 0,
      sourceType: this.type,
      hazardId: this.id,
    }
    this.isAftermathCleared = false
    this._colliderVersion = 1
    this._colliderEntries = []
    this.collapseYaw = 0
    this.localPatchOffset = null
    this.ceilingSoffitY = 3.6
    this.rubbleHalfW = 0.44
    this.rubbleHalfD = 0.44
    this.clearBias = null
    this.lateralOffset = 0.46
    this.tipDir = null
    this.localUprightOffset = null
    this.uprightHalfW = 0.45
    this.uprightHalfD = 0.23
    this.aftermathHalfW = 0.46
    this.aftermathHalfD = 0.72
    this.pipeYaw = 0
    this.pipeRestY = 3.12
    this.rollDir = null
    this.localOverheadOffset = null
    this.steamYaw = 0
    this.pipeMainY = 1.38
    this.ruptureDir = null
    this.localRuptureOffset = null
    this.localValveOffset = null
    this.valveWorldPos = null
    this._customColliderSpecs = Array.isArray(spec.colliders) ? spec.colliders : null
    this._interactionHandler =
      spec.interaction && typeof spec.interaction === 'object'
        ? spec.interaction
        : this._buildDefaultInteractionHandler()
    this._interactableOut = {
      kind: 'hazard',
      id: this.id,
      type: this.type,
      action: 'interact',
      label: 'Interact',
      shortLabel: 'Use',
      distance: Infinity,
      worldPos: { x: 0, y: 0, z: 0 },
    }

    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
      const resolved = resolveCeilingCollapseMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.wallSide || null
      )
      this.wallSide = spec.wallSide !== undefined ? spec.wallSide : resolved.wallSide
      this.collapseYaw = Number.isFinite(spec.collapseYaw)
        ? spec.collapseYaw
        : resolved.collapseYaw
      this.localPatchOffset = spec.localPatchOffset
        ? { ...spec.localPatchOffset }
        : { ...resolved.localPatchOffset }
      this.ceilingSoffitY = Number.isFinite(spec.ceilingSoffitY)
        ? spec.ceilingSoffitY
        : resolved.ceilingSoffitY
      this.rubbleHalfW = Number.isFinite(spec.rubbleHalfW)
        ? spec.rubbleHalfW
        : resolved.rubbleHalfW
      this.rubbleHalfD = Number.isFinite(spec.rubbleHalfD)
        ? spec.rubbleHalfD
        : resolved.rubbleHalfD
      this.clearBias = spec.clearBias ? { ...spec.clearBias } : { ...resolved.clearBias }
    } else if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      const resolved = resolveRottenFurnitureMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.wallSide || null
      )
      this.wallSide = spec.wallSide !== undefined ? spec.wallSide : resolved.wallSide
      this.wallRow = Number.isInteger(spec.wallRow) ? spec.wallRow : resolved.wallRow
      this.wallCol = Number.isInteger(spec.wallCol) ? spec.wallCol : resolved.wallCol
      this.wallYaw = Number.isFinite(spec.wallYaw) ? spec.wallYaw : resolved.wallYaw
      this.lateralOffset = Number.isFinite(spec.lateralOffset)
        ? spec.lateralOffset
        : resolved.lateralOffset
      this.tipDir = spec.tipDir ? { ...spec.tipDir } : { ...resolved.tipDir }
      this.localUprightOffset = spec.localUprightOffset
        ? { ...spec.localUprightOffset }
        : { ...resolved.localUprightOffset }
      this.localDischargeOffset = spec.localImpactOffset
        ? { ...spec.localImpactOffset }
        : { ...resolved.localImpactOffset }
      this.uprightHalfW = Number.isFinite(spec.uprightHalfW)
        ? spec.uprightHalfW
        : resolved.uprightHalfW
      this.uprightHalfD = Number.isFinite(spec.uprightHalfD)
        ? spec.uprightHalfD
        : resolved.uprightHalfD
      this.aftermathHalfW = Number.isFinite(spec.aftermathHalfW)
        ? spec.aftermathHalfW
        : resolved.aftermathHalfW
      this.aftermathHalfD = Number.isFinite(spec.aftermathHalfD)
        ? spec.aftermathHalfD
        : resolved.aftermathHalfD
    } else if (this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
      const resolved = resolveFallingPipesMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.wallSide || null
      )
      this.mountType = spec.mountType || resolved.mountType
      this.wallSide = spec.wallSide !== undefined ? spec.wallSide : resolved.wallSide
      this.wallRow = Number.isInteger(spec.wallRow) ? spec.wallRow : resolved.wallRow
      this.wallCol = Number.isInteger(spec.wallCol) ? spec.wallCol : resolved.wallCol
      this.pipeYaw = Number.isFinite(spec.pipeYaw) ? spec.pipeYaw : resolved.pipeYaw
      this.corridorAxis = spec.corridorAxis || resolved.corridorAxis
      this.rollDir = spec.rollDir ? { ...spec.rollDir } : { ...resolved.rollDir }
      this.localOverheadOffset = spec.localOverheadOffset
        ? { ...spec.localOverheadOffset }
        : { ...resolved.localOverheadOffset }
      this.localDischargeOffset = spec.localImpactOffset
        ? { ...spec.localImpactOffset }
        : { ...resolved.localImpactOffset }
      this.pipeRestY = Number.isFinite(spec.pipeRestY) ? spec.pipeRestY : resolved.pipeRestY
      this.ceilingAnchorY = Number.isFinite(spec.ceilingAnchorY)
        ? spec.ceilingAnchorY
        : resolved.ceilingAnchorY
      this.aftermathHalfW = Number.isFinite(spec.aftermathHalfW)
        ? spec.aftermathHalfW
        : resolved.aftermathHalfW
      this.aftermathHalfD = Number.isFinite(spec.aftermathHalfD)
        ? spec.aftermathHalfD
        : resolved.aftermathHalfD
    } else if (this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
      const resolved = resolveSteamPipeMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.wallSide || null
      )
      this.mountType = spec.mountType || resolved.mountType
      this.wallSide = spec.wallSide !== undefined ? spec.wallSide : resolved.wallSide
      this.wallRow = Number.isInteger(spec.wallRow) ? spec.wallRow : resolved.wallRow
      this.wallCol = Number.isInteger(spec.wallCol) ? spec.wallCol : resolved.wallCol
      this.steamYaw = Number.isFinite(spec.steamYaw) ? spec.steamYaw : resolved.steamYaw
      this.corridorAxis = spec.corridorAxis || resolved.corridorAxis
      this.ruptureDir = spec.ruptureDir ? { ...spec.ruptureDir } : { ...resolved.ruptureDir }
      this.localRuptureOffset = spec.localRuptureOffset
        ? { ...spec.localRuptureOffset }
        : { ...resolved.localRuptureOffset }
      this.localValveOffset = spec.localValveOffset
        ? { ...spec.localValveOffset }
        : { ...resolved.localValveOffset }
      this.localDischargeOffset = spec.localImpactOffset
        ? { ...spec.localImpactOffset }
        : { ...resolved.localImpactOffset }
      this.pipeMainY = Number.isFinite(spec.pipeMainY) ? spec.pipeMainY : resolved.pipeMainY
      this.ceilingAnchorY = Number.isFinite(spec.ceilingAnchorY)
        ? spec.ceilingAnchorY
        : resolved.ceilingAnchorY
    } else if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
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
      lateralOffset: this.lateralOffset,
      collapseYaw: this.collapseYaw,
      localPatchOffset: this.localPatchOffset,
      ceilingSoffitY: this.ceilingSoffitY,
      clearBias: this.clearBias,
      activeDuration: this.config.activeDuration,
      tankYaw: this.tankYaw,
      surgeLength: this.surgeLength,
      surgeHalfWidth: this.surgeHalfWidth,
      tankRestY: this.tankRestY,
      machineryYaw: this.machineryYaw,
      machineryRestY: this.machineryRestY,
      ductYaw: this.ductYaw,
      ductRestY: this.ductRestY,
      pipeYaw: this.pipeYaw,
      pipeRestY: this.pipeRestY,
      steamYaw: this.steamYaw,
      pipeMainY: this.pipeMainY,
      ceilingAnchorY: this.ceilingAnchorY,
      corridorAxis: this.corridorAxis,
      grateYaw: this.grateYaw,
      floorY: this.floorY,
    })
    if (this.maze && Number.isFinite(this.row) && Number.isFinite(this.col)) {
      const pos = gridToWorld(this.row, this.col, this.maze)
      if (pos) {
        this.cellWorldPos = { x: pos.x, y: 0, z: pos.z }
        if (this.mesh) {
          this.mesh.position.set(pos.x, 0, pos.z)
        }
        if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
          const px = pos.x + (this.localPatchOffset?.x || 0)
          const pz = pos.z + (this.localPatchOffset?.z || 0)
          this.dangerWorldPos = { x: px, y: 0.4, z: pz }
          this.worldPos = { x: px, y: 2.6, z: pz }
        } else if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
          const upOff = this.localUprightOffset || { x: 0.46, y: 0.68, z: -1.73 }
          const impOff = this.localDischargeOffset || { x: 0.46, y: 0.38, z: -0.86 }
          this.originWorldPos = {
            x: pos.x + upOff.x,
            y: upOff.y,
            z: pos.z + upOff.z,
          }
          this.dangerWorldPos = {
            x: pos.x + impOff.x,
            y: impOff.y,
            z: pos.z + impOff.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
        } else if (this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
          const overOff = this.localOverheadOffset || { x: 0, y: 3.12, z: -1.32 }
          const impOff = this.localDischargeOffset || { x: 0, y: 0.18, z: -1.06 }
          this.originWorldPos = {
            x: pos.x + overOff.x,
            y: overOff.y,
            z: pos.z + overOff.z,
          }
          this.dangerWorldPos = {
            x: pos.x + impOff.x,
            y: impOff.y,
            z: pos.z + impOff.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
        } else if (this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
          const rupOff = this.localRuptureOffset || { x: 0.14, y: 1.38, z: -1.72 }
          const valOff = this.localValveOffset || { x: -0.58, y: 1.28, z: -1.72 }
          const impOff = this.localDischargeOffset || { x: 0.08, y: 1.25, z: -0.68 }
          this.originWorldPos = {
            x: pos.x + rupOff.x,
            y: rupOff.y,
            z: pos.z + rupOff.z,
          }
          this.valveWorldPos = {
            x: pos.x + valOff.x,
            y: valOff.y,
            z: pos.z + valOff.z,
          }
          this.dangerWorldPos = {
            x: pos.x + impOff.x,
            y: impOff.y,
            z: pos.z + impOff.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
        } else if (
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
    this._rebuildColliderEntries()
    this._syncColliderStates(0)
    updateHazardVisualState(this.mesh, this.state, 0)
  }

  _buildDefaultInteractionHandler() {
    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
      return {
        range: 2.25,
        canInteract: (agent) =>
          (agent.state === HAZARD_STATES.DISABLED || agent.isPermanentlyCollapsed) &&
          !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'clear_rubble',
          label: 'Clear Ceiling Rubble',
          shortLabel: 'Clear',
        }),
        onInteract: () => ({
          handled: true,
          action: 'clear_rubble',
          clearAftermath: true,
          emitSoundRange: 4.5,
        }),
      }
    }
    if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      return {
        range: 2.25,
        canInteract: (agent) =>
          (agent.state === HAZARD_STATES.DISABLED || agent.isPermanentlyCollapsed) &&
          !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'clear_furniture',
          label: 'Clear Fallen Furniture',
          shortLabel: 'Clear',
        }),
        onInteract: () => ({
          handled: true,
          action: 'clear_furniture',
          clearAftermath: true,
          emitSoundRange: 4.5,
        }),
      }
    }
    if (this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
      return {
        range: 2.25,
        canInteract: (agent) =>
          (agent.state === HAZARD_STATES.DISABLED || agent.isPermanentlyCollapsed) &&
          !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'clear_pipe',
          label: 'Move Fallen Pipe',
          shortLabel: 'Move',
        }),
        onInteract: () => ({
          handled: true,
          action: 'clear_pipe',
          clearAftermath: true,
          emitSoundRange: 4.5,
        }),
      }
    }
    if (this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
      return {
        range: 2.35,
        canInteract: (agent) =>
          (agent.state !== HAZARD_STATES.DORMANT || agent.isPermanentlyCollapsed) &&
          !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'shut_off_steam_valve',
          label: 'Shut Off Steam Valve',
          shortLabel: 'Shut Off',
        }),
        onInteract: () => ({
          handled: true,
          action: 'shut_off_steam_valve',
          disableHazard: true,
          clearAftermath: true,
          emitSoundRange: 4.0,
        }),
      }
    }
    return null
  }

  _applyInitialTimerPhase() {
    this.state = HAZARD_STATES.DORMANT
    this.timer = 0
    this.hasDealtDamage = false
    this.isPermanentlyCollapsed = false
    this.isDisabled = false
    this.isAftermathCleared = false
    this.lastMovementEffect = null
  }

  _buildDefaultColliderTemplates() {
    // Only attach automatic dormant/aftermath colliders for hazards whose geometry
    // is grounded AND leaves >= PLAYER_RADIUS * 2 + 0.1 (1.60m) navigable clearance:
    //  - ceiling_collapse: coffer-bay rubble mound (0.88m x 0.88m, leaves >= 2.40m).
    //  - rotten_furniture_collapse: wall-side storage cabinet (dormant against wall
    //    leaves 3.50m; collapsed forward leaves >= 2.00m on both axes).
    //  - falling_pipes_fixtures: overhead pipe & valve assembly (no dormant floor
    //    collider; fallen pipe along wall leaves >= 2.80m open corridor lane).
    //  - wall_collapse: rests flush against a wall (leaves ~3.00m passage).
    //  - ventilation_duct_collapse: narrow 0.72m fallen duct (leaves 1.64m per side
    //    in straight corridors; HazardManager gates corner/tight placements via
    //    validateHazardColliderPlacement so it can never soft-lock).
    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
      return [
        {
          id: `${this.id}:aftermath-rubble`,
          phase: 'aftermath',
          activateProgress: 0.46,
          kind: 'obb',
          localX: this.localPatchOffset?.x ?? 0,
          localZ: this.localPatchOffset?.z ?? -0.96,
          halfW: this.rubbleHalfW ?? 0.44,
          halfD: this.rubbleHalfD ?? 0.44,
          baseYaw: 0,
          yawOffset: 0,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      return [
        {
          id: `${this.id}:dormant-furniture`,
          phase: 'dormant',
          activateProgress: 0.42,
          kind: 'obb',
          localX: Number.isFinite(this.lateralOffset) ? this.lateralOffset : 0.46,
          localZ: -1.73,
          halfW: this.uprightHalfW ?? 0.45,
          halfD: this.uprightHalfD ?? 0.23,
          baseYaw: this.wallYaw,
          yawOffset: 0,
        },
        {
          id: `${this.id}:aftermath-furniture`,
          phase: 'aftermath',
          activateProgress: 0.42,
          kind: 'obb',
          localX: Number.isFinite(this.lateralOffset) ? this.lateralOffset : 0.46,
          localZ: -0.82,
          halfW: this.aftermathHalfW ?? 0.46,
          halfD: this.aftermathHalfD ?? 0.72,
          baseYaw: this.wallYaw,
          yawOffset: 0,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
      return [
        {
          id: `${this.id}:aftermath-pipe`,
          phase: 'aftermath',
          activateProgress: 0.46,
          kind: 'obb',
          localX: 0,
          localZ: -1.06,
          halfW: this.aftermathHalfW ?? 0.88,
          halfD: this.aftermathHalfD ?? 0.26,
          baseYaw: this.pipeYaw,
          yawOffset: 0,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.WALL_COLLAPSE) {
      return [
        {
          id: `${this.id}:aftermath-rubble`,
          phase: 'aftermath',
          activateProgress: 0.52,
          kind: 'obb',
          localX: 0,
          localZ: -1.48,
          halfW: 1.05,
          halfD: 0.48,
          baseYaw: this.wallYaw,
          yawOffset: 0,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
      return [
        {
          id: `${this.id}:aftermath-duct`,
          phase: 'aftermath',
          activateProgress: 0.48,
          kind: 'obb',
          localX: 0,
          localZ: 0.56,
          halfW: 0.36,
          halfD: 1.0,
          baseYaw: this.ductYaw,
          yawOffset: 0,
        },
      ]
    }
    return []
  }

  _rebuildColliderEntries() {
    const templates = Array.isArray(this._customColliderSpecs)
      ? this._customColliderSpecs
      : this._buildDefaultColliderTemplates()
    const baseX = this.cellWorldPos ? this.cellWorldPos.x : this.worldPos?.x || 0
    const baseZ = this.cellWorldPos ? this.cellWorldPos.z : this.worldPos?.z || 0
    const nextEntries = []

    for (let i = 0; i < templates.length; i += 1) {
      const tpl = templates[i]
      if (!tpl) continue
      const baseYaw = Number.isFinite(tpl.baseYaw) ? tpl.baseYaw : 0
      const cosYaw = Math.cos(baseYaw)
      const sinYaw = Math.sin(baseYaw)
      const lx = Number(tpl.localX) || 0
      const lz = Number(tpl.localZ) || 0
      const cx = Number.isFinite(tpl.cx) ? tpl.cx : baseX + lx * cosYaw + lz * sinYaw
      const cz = Number.isFinite(tpl.cz) ? tpl.cz : baseZ - lx * sinYaw + lz * cosYaw
      const kind = tpl.kind === 'circle' ? 'circle' : 'obb'
      const yaw = Number.isFinite(tpl.yaw)
        ? tpl.yaw
        : baseYaw + (Number.isFinite(tpl.yawOffset) ? tpl.yawOffset : 0)

      nextEntries.push({
        id: tpl.id || `${this.id}:col-${i}`,
        ownerId: this.id,
        propId: this.id,
        propType: this.type,
        row: this.row,
        col: this.col,
        phase: tpl.phase || 'aftermath',
        activateProgress: Number.isFinite(tpl.activateProgress) ? tpl.activateProgress : 0.48,
        kind,
        cx,
        cz,
        halfW: Number.isFinite(tpl.halfW) ? tpl.halfW : 0.4,
        halfD: Number.isFinite(tpl.halfD) ? tpl.halfD : 0.4,
        radius: Number.isFinite(tpl.radius) ? tpl.radius : 0.4,
        yaw,
        enabled: false,
      })
    }

    this._colliderEntries = nextEntries
    this._colliderVersion += 1
  }

  _shouldColliderBeEnabled(entry, activeProgress = 0) {
    if (this.isDisposed) return false
    if (entry.phase === 'always') {
      return !this.isAftermathCleared
    }
    if (entry.phase === 'dormant') {
      if (this.isPermanentlyCollapsed || this.isDisabled || this.state === HAZARD_STATES.DISABLED) {
        return false
      }
      if (this.state === HAZARD_STATES.ACTIVE) {
        return activeProgress < entry.activateProgress
      }
      return true
    }
    // Default: 'aftermath'
    if (this.isAftermathCleared) {
      return false
    }
    if (this.isPermanentlyCollapsed || this.state === HAZARD_STATES.DISABLED) {
      return true
    }
    if (this.state === HAZARD_STATES.ACTIVE) {
      return activeProgress >= entry.activateProgress
    }
    return false
  }

  _syncColliderStates(activeProgress = 0) {
    let changed = false
    for (let i = 0; i < this._colliderEntries.length; i += 1) {
      const entry = this._colliderEntries[i]
      const nextEnabled = this._shouldColliderBeEnabled(entry, activeProgress)
      if (entry.enabled !== nextEnabled) {
        entry.enabled = nextEnabled
        changed = true
      }
    }
    if (changed) {
      this._colliderVersion += 1
    }
    return changed
  }

  getColliderSpecs() {
    return this._colliderEntries
  }

  getColliderVersion() {
    return this._colliderVersion
  }

  setColliderSpecs(specs = null) {
    if (this.isDisposed) return
    this._customColliderSpecs = Array.isArray(specs) ? specs : null
    this._rebuildColliderEntries()
    const activeProgress =
      this.state === HAZARD_STATES.ACTIVE && this.config.activeDuration > 0
        ? Math.min(1, this.timer / this.config.activeDuration)
        : this.state === HAZARD_STATES.DISABLED || this.isPermanentlyCollapsed
          ? 1
          : 0
    this._syncColliderStates(activeProgress)
  }

  clearAftermath() {
    if (this.isDisposed || this.isAftermathCleared) return false
    this.isAftermathCleared = true
    this._syncColliderStates(1)
    if (this.mesh?.userData) {
      this.mesh.userData.isAftermathCleared = true
      updateHazardVisualState(this.mesh, this.state, 1)
    }
    return true
  }

  setInteractionHandler(handler = null) {
    if (this.isDisposed) return
    this._interactionHandler =
      handler && typeof handler === 'object' ? handler : null
  }

  getInteractionHandler() {
    return this._interactionHandler
  }

  getInteractionAnchor() {
    if (this.type === HAZARD_TYPES.STEAM_PIPE_BURST && this.valveWorldPos) {
      return this.valveWorldPos
    }
    if (this.dangerWorldPos) return this.dangerWorldPos
    if (this.worldPos) return this.worldPos
    return this.cellWorldPos
  }

  canPlayerInteract(playerWorldPos, playerGridCell = null) {
    if (this.isDisposed || !this._interactionHandler || !playerWorldPos) {
      return false
    }
    const handler = this._interactionHandler
    if (typeof handler.canInteract === 'function') {
      if (!handler.canInteract(this, { playerWorldPos, playerGridCell })) {
        return false
      }
    }
    const anchor = this.getInteractionAnchor()
    if (!anchor) return false

    const range = Number.isFinite(handler.range)
      ? Math.max(0.1, handler.range)
      : DEFAULT_HAZARD_INTERACT_RANGE
    const dist = Math.hypot(playerWorldPos.x - anchor.x, playerWorldPos.z - anchor.z)
    if (dist > range) {
      return false
    }

    if (
      this.maze &&
      !hasLineOfSightInMaze(
        playerWorldPos.x,
        playerWorldPos.z,
        anchor.x,
        anchor.z,
        this.maze
      )
    ) {
      return false
    }

    return true
  }

  getInteractableDescriptor(playerWorldPos, playerGridCell = null) {
    if (!this.canPlayerInteract(playerWorldPos, playerGridCell)) {
      return null
    }
    const handler = this._interactionHandler
    const anchor = this.getInteractionAnchor()
    const dist = Math.hypot(playerWorldPos.x - anchor.x, playerWorldPos.z - anchor.z)
    const prompt =
      typeof handler.getPrompt === 'function' ? handler.getPrompt(this) : handler

    const out = this._interactableOut
    out.kind = 'hazard'
    out.id = this.id
    out.type = this.type
    out.action = prompt?.action || 'hazard_interact'
    out.label = prompt?.label || 'Interact'
    out.shortLabel = prompt?.shortLabel || 'Use'
    out.distance = dist
    out.worldPos.x = anchor.x
    out.worldPos.y = anchor.y || 0
    out.worldPos.z = anchor.z
    return out
  }

  interact(context = null) {
    if (this.isDisposed || !this._interactionHandler) {
      return { handled: false, action: null, hazard: this, clearAftermath: false, emitSoundRange: 0 }
    }
    if (
      context?.playerWorldPos &&
      !this.canPlayerInteract(context.playerWorldPos, context.playerGridCell || null)
    ) {
      return { handled: false, action: null, hazard: this, clearAftermath: false, emitSoundRange: 0 }
    }

    const handler = this._interactionHandler
    const raw =
      typeof handler.onInteract === 'function'
        ? handler.onInteract(this, context)
        : { handled: false }
    const handled = Boolean(raw?.handled)
    if (handled && raw?.disableHazard) {
      this.isPermanentlyCollapsed = true
      this.isDisabled = true
      this.state = HAZARD_STATES.DISABLED
      this.timer = 0
      this.lastMovementEffect = null
      if (this.mesh?.userData) {
        this.mesh.userData.isPermanentlyCollapsed = true
      }
    }
    if (handled && raw?.clearAftermath) {
      this.clearAftermath()
    }
    return {
      handled,
      action: raw?.action || (handled ? 'hazard_interact' : null),
      hazard: this,
      clearAftermath: Boolean(raw?.clearAftermath),
      emitSoundRange: Number.isFinite(raw?.emitSoundRange) ? Math.max(0, raw.emitSoundRange) : 0,
      data: raw?.data ?? null,
    }
  }

  getMesh() {
    return this.mesh
  }

  getState() {
    return this.state
  }

  getDangerArea() {
    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        wallSide: this.wallSide,
        ceilingSoffitY: this.ceilingSoffitY,
        localPatchOffset: this.localPatchOffset ? { ...this.localPatchOffset } : null,
        rubbleHalfW: this.rubbleHalfW,
        rubbleHalfD: this.rubbleHalfD,
      }
    }
    if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        origin: this.originWorldPos ? { ...this.originWorldPos } : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        wallYaw: this.wallYaw,
        lateralOffset: this.lateralOffset,
        tipDir: this.tipDir ? { ...this.tipDir } : null,
        uprightHalfW: this.uprightHalfW,
        uprightHalfD: this.uprightHalfD,
        aftermathHalfW: this.aftermathHalfW,
        aftermathHalfD: this.aftermathHalfD,
      }
    }
    if (this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        origin: this.originWorldPos ? { ...this.originWorldPos } : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        pipeYaw: this.pipeYaw,
        corridorAxis: this.corridorAxis,
        rollDir: this.rollDir ? { ...this.rollDir } : null,
        pipeRestY: this.pipeRestY,
        ceilingAnchorY: this.ceilingAnchorY,
        aftermathHalfW: this.aftermathHalfW,
        aftermathHalfD: this.aftermathHalfD,
      }
    }
    if (this.type === HAZARD_TYPES.STEAM_PIPE_BURST && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        origin: this.originWorldPos ? { ...this.originWorldPos } : { ...this.dangerWorldPos },
        valve: this.valveWorldPos ? { ...this.valveWorldPos } : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        steamYaw: this.steamYaw,
        corridorAxis: this.corridorAxis,
        ruptureDir: this.ruptureDir ? { ...this.ruptureDir } : null,
        pipeMainY: this.pipeMainY,
        ceilingAnchorY: this.ceilingAnchorY,
      }
    }
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
    if (this._interactionHandler && typeof this._interactionHandler.onReset === 'function') {
      this._interactionHandler.onReset(this)
    }
    this._syncColliderStates(0)
    if (this.mesh?.userData) {
      this.mesh.userData.isPermanentlyCollapsed = false
      this.mesh.userData.isAftermathCleared = false
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
      this.type === HAZARD_TYPES.CEILING_COLLAPSE ||
      this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE ||
      this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES ||
      this.type === HAZARD_TYPES.STEAM_PIPE_BURST ||
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
      if (!isPlayerInImpactArea && playerContext?.playerWorldPos && this.cellWorldPos) {
        const dx = playerContext.playerWorldPos.x - this.cellWorldPos.x
        const dz = playerContext.playerWorldPos.z - this.cellWorldPos.z
        if (Math.hypot(dx, dz) <= 0.85) {
          isPlayerInImpactArea = true
        }
      }
    }

    if (this.state === HAZARD_STATES.DORMANT) {
      this.hasDealtDamage = false
      if (
        this.type === HAZARD_TYPES.CEILING_COLLAPSE ||
        this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE ||
        this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES ||
        this.type === HAZARD_TYPES.STEAM_PIPE_BURST ||
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
      if (
        this.type === HAZARD_TYPES.CEILING_COLLAPSE ||
        this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE ||
        this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES ||
        this.type === HAZARD_TYPES.STEAM_PIPE_BURST
      ) {
        const activeProgress =
          this.config.activeDuration > 0
            ? Math.min(1, this.timer / this.config.activeDuration)
            : 1
        const impactEnd = this.config.impactWindowEndProgress ?? 0.68
        if (activeProgress > impactEnd) {
          isPlayerInImpactArea = false
        }
      } else if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
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
        this._syncColliderStates(1)
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
    if (this.state === HAZARD_STATES.ACTIVE) {
      this._syncColliderStates(progress)
    }
    updateHazardVisualState(this.mesh, this.state, progress)

    return hit
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this._syncColliderStates(0)
    this._colliderEntries = []
    this._customColliderSpecs = null
    this._interactionHandler = null
    if (this.mesh) {
      disposeHazardMesh(this.mesh)
      this.mesh = null
    }
    this.maze = null
    this.worldPos = null
    this.cellWorldPos = null
    this.dangerWorldPos = null
    this.localDischargeOffset = null
    this.localPatchOffset = null
    this.localUprightOffset = null
    this.localOverheadOffset = null
    this.localRuptureOffset = null
    this.localValveOffset = null
    this.valveWorldPos = null
    this.clearBias = null
    this.tipDir = null
    this.rollDir = null
    this.ruptureDir = null
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
