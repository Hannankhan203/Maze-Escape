import {
  CEILING_COLLAPSE_CONSTANTS,
  FALLING_PIPES_CONSTANTS,
  FLOOR_GRATE_CONSTANTS,
  HAZARD_TYPES,
  ROTTEN_FURNITURE_CONSTANTS,
  STEAM_PIPE_CONSTANTS,
  SUSPENDED_MACHINERY_CONSTANTS,
  VENTILATION_DUCT_CONSTANTS,
  WALL_COLLAPSE_CONSTANTS,
  WATER_TANK_CONSTANTS,
  resolveCeilingCollapseMount,
  resolveRottenFurnitureMount,
  resolveFallingPipesMount,
  resolveSteamPipeMount,
  resolveElectricalMount,
  resolveFloorGrateMount,
  resolveWallCollapseMount,
  resolveWaterTankMount,
  resolveSuspendedMachineryMount,
  resolveVentilationDuctMount,
} from '../generation/hazardPlacement.js'
import {
  buildHazardMesh,
  updateHazardVisualState,
  disposeHazardMesh,
  computeRottenFurniturePose,
  ROTTEN_FURNITURE_HANDLING_LIMITS,
} from './buildHazards.js'
import { hasLineOfSightInMaze } from '../world/gridCollision.js'
import { hasUnobstructedPropLineOfSight } from '../world/propCollision.js'
import { gridToWorld, worldToGrid } from '../world/worldCoords.js'

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
    warningDuration: 0.95,
    activeDuration: 1.2,
    cooldownDuration: 0,
    damage: 35,
    triggerRadius: CEILING_COLLAPSE_CONSTANTS.triggerHalfD,
    dangerRadius: CEILING_COLLAPSE_CONSTANTS.dangerHalfD,
    dangerHalfW: CEILING_COLLAPSE_CONSTANTS.dangerHalfW,
    dangerHalfD: CEILING_COLLAPSE_CONSTANTS.dangerHalfD,
    triggerHalfW: CEILING_COLLAPSE_CONSTANTS.triggerHalfW,
    triggerHalfD: CEILING_COLLAPSE_CONSTANTS.triggerHalfD,
    impactWindowEndProgress: 0.68,
    activationSoundRange: 12.5,
  },
  [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE]: {
    dormantDuration: 0,
    warningDuration: 0.9,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: ROTTEN_FURNITURE_CONSTANTS.triggerHalfWOpen,
    dangerRadius: ROTTEN_FURNITURE_CONSTANTS.dangerHalfWOpen,
    triggerHalfD: ROTTEN_FURNITURE_CONSTANTS.triggerHalfD,
    dangerHalfD: ROTTEN_FURNITURE_CONSTANTS.dangerHalfD,
    impactWindowEndProgress: 0.68,
    activationSoundRange: 9.5,
  },
  [HAZARD_TYPES.FALLING_PIPES_FIXTURES]: {
    dormantDuration: 0,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.15,
    dangerRadius: 1.18,
    dangerHalfW: FALLING_PIPES_CONSTANTS.dangerHalfW,
    dangerHalfD: FALLING_PIPES_CONSTANTS.dangerHalfD,
    impactWindowEndProgress: 0.68,
    activationSoundRange: 11.0,
  },
  [HAZARD_TYPES.STEAM_PIPE_BURST]: {
    dormantDuration: 0,
    warningDuration: 1.2,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.15,
    dangerRadius: 1.28,
    dangerCenterLocalX: STEAM_PIPE_CONSTANTS.dangerCenterLocalX,
    dangerHalfW: STEAM_PIPE_CONSTANTS.dangerHalfW,
    dangerMinLocalZ: STEAM_PIPE_CONSTANTS.dangerMinLocalZ,
    dangerMaxLocalZ: STEAM_PIPE_CONSTANTS.dangerMaxLocalZ,
    activationSoundRange: 11.0,
  },
  [HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]: {
    dormantDuration: 0,
    warningDuration: 1.3,
    activeDuration: 0.9,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.15,
    dangerRadius: 0.98,
    activationSoundRange: 9.5,
  },
  [HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]: {
    dormantDuration: 0,
    warningDuration: 1.05,
    activeDuration: 0.95,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 0.98,
    dangerRadius: 0.88,
    impactWindowEndProgress: 0.72,
    activationSoundRange: 11.0,
  },
  [HAZARD_TYPES.WALL_COLLAPSE]: {
    dormantDuration: 0,
    warningDuration: 1.4,
    activeDuration: 0.95,
    cooldownDuration: 0,
    damage: 35,
    triggerRadius: 2.15,
    dangerRadius: 1.15,
    impactWindowEndProgress: 0.66,
    dangerHalfW: WALL_COLLAPSE_CONSTANTS.dangerHalfW,
    dangerMinLocalZ: WALL_COLLAPSE_CONSTANTS.dangerMinLocalZ,
    dangerMaxLocalZ: WALL_COLLAPSE_CONSTANTS.dangerMaxLocalZ,
    activationSoundRange: 12.5,
  },
  [HAZARD_TYPES.FALLING_WATER_TANK]: {
    dormantDuration: 0,
    warningDuration: 1.45,
    activeDuration: 1.35,
    cooldownDuration: 0,
    damage: 30,
    triggerRadius: 2.4,
    dangerRadius: 1.15,
    impactWindowEndProgress: 0.72,
    surgeStartProgress: WATER_TANK_CONSTANTS.surgeStartProgress,
    surgeHalfWidth: 1.05,
    surgeSpeedMultiplier: 0.62,
    surgeSlowdownDuration: 1.8,
    activationSoundRange: 12.5,
  },
  [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]: {
    dormantDuration: 0,
    warningDuration: 1.5,
    activeDuration: 1.05,
    cooldownDuration: 0,
    damage: 40,
    triggerRadius: 2.5,
    dangerRadius: 1.25,
    impactWindowEndProgress: 0.72,
    activationSoundRange: 13.0,
  },
  [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]: {
    dormantDuration: 0,
    warningDuration: 1.4,
    activeDuration: 1.0,
    cooldownDuration: 0,
    damage: 35,
    triggerRadius: 2.45,
    dangerRadius: 1.2,
    impactWindowEndProgress: 0.72,
    ductHalfWidth: 0.88,
    ductMinLocalZ: -0.58,
    ductMaxLocalZ: 1.68,
    activationSoundRange: 12.0,
  },
}

let _nextFallbackHazardId = 1

/**
 * ReusableHazardAgent for managing environmental hazards in 3D maze.
 */
export class HazardAgent {
  constructor(spec = {}, maze = null, options = {}) {
    if (!spec?.type || !Object.prototype.hasOwnProperty.call(HAZARD_CONFIG, spec.type)) {
      throw new Error(`Unsupported hazard type: ${spec?.type}`)
    }
    const rawId = typeof spec.id === 'string' ? spec.id.trim() : ''
    this.id =
      rawId ||
      `hazard-${spec.type}-${spec.row ?? 'x'}-${spec.col ?? 'x'}-${_nextFallbackHazardId++}`
    this.type = spec.type
    this.row = spec.row
    this.col = spec.col
    this.maze = maze
    this.isManual = Boolean(spec.isManual || spec.placementOrigin === 'manual')
    this.placementOrigin = spec.placementOrigin || (this.isManual ? 'manual' : 'automatic')
    this.manualId = spec.manualId || null
    this.placementPreference = spec.placementPreference || 'auto'
    this.qualityPreset = options?.qualityPreset || spec?.qualityPreset || 'high'
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
    this.sideSign = 1
    this.fallenTankWorldPos = null
    this.surgeLength = 2.55
    this.surgeHalfWidth = 1.05
    this.tankRestY = WATER_TANK_CONSTANTS.tankRestY
    this.ceilingAnchorY = WATER_TANK_CONSTANTS.ceilingAnchorY
    this.swingSide = null
    this.swingDir = null
    this.machineryYaw = 0
    this.machineryRestY = SUSPENDED_MACHINERY_CONSTANTS.machineryRestY
    this.ceilingStructureType = 'rib_hanger'
    this.ceilingBeamY = 3.38
    this.hasSideWall = false
    this.clearedLocalX = SUSPENDED_MACHINERY_CONSTANTS.clearedLocalX
    this.clearedLocalZ = SUSPENDED_MACHINERY_CONSTANTS.clearedLocalZ
    this.aftermathYawOffset = SUSPENDED_MACHINERY_CONSTANTS.fallenRy
    this.fallenMachineryWorldPos = null
    this.dropSide = null
    this.dropDir = null
    this.ductYaw = 0
    this.ductRestY = VENTILATION_DUCT_CONSTANTS.ductRestY
    this.hangerPivotY = VENTILATION_DUCT_CONSTANTS.ceilingAnchorY
    this.fallenY = VENTILATION_DUCT_CONSTANTS.fallenY
    this.fallenDuctWorldPos = null
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
    this.steamDangerCenterLocalX = STEAM_PIPE_CONSTANTS.dangerCenterLocalX
    this.steamDangerHalfW = STEAM_PIPE_CONSTANTS.dangerHalfW
    this.steamDangerMinLocalZ = STEAM_PIPE_CONSTANTS.dangerMinLocalZ
    this.steamDangerMaxLocalZ = STEAM_PIPE_CONSTANTS.dangerMaxLocalZ
    this.localJunctionOffset = null
    this.localBreakerOffset = null
    this.breakerWorldPos = null
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
    this._interactTargetOut = { x: 0, y: 0, z: 0, dist: Infinity }

    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
      const resolved = resolveCeilingCollapseMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.wallSide || null
      )
      this.wallSide = spec.wallSide !== undefined ? spec.wallSide : resolved.wallSide
      this.corridorAxis = spec.corridorAxis || resolved.corridorAxis
      this.collapseYaw = Number.isFinite(spec.collapseYaw)
        ? spec.collapseYaw
        : resolved.collapseYaw
      this.localPatchOffset = spec.localPatchOffset
        ? { ...spec.localPatchOffset }
        : { ...resolved.localPatchOffset }
      this.ceilingSoffitY = Number.isFinite(spec.ceilingSoffitY)
        ? spec.ceilingSoffitY
        : resolved.ceilingSoffitY
      const offX = Number(this.localPatchOffset?.x) || 0
      const offZ = Number(this.localPatchOffset?.z) || 0
      const cosY = Math.cos(this.collapseYaw || 0)
      const sinY = Math.sin(this.collapseYaw || 0)
      const transShift = Math.abs(offX * cosY - offZ * sinY)
      const maxTransHalfW = Math.max(0.44, 1.92 - transShift)
      this.rubbleHalfW = Number.isFinite(spec.rubbleHalfW)
        ? spec.rubbleHalfW
        : Math.min(resolved.rubbleHalfW, maxTransHalfW)
      this.rubbleMinLocalZ = Number.isFinite(spec.rubbleMinLocalZ)
        ? spec.rubbleMinLocalZ
        : resolved.rubbleMinLocalZ
      this.rubbleMaxLocalZ = Number.isFinite(spec.rubbleMaxLocalZ)
        ? spec.rubbleMaxLocalZ
        : resolved.rubbleMaxLocalZ
      this.rubbleCenterLocalZ = Number.isFinite(spec.rubbleCenterLocalZ)
        ? spec.rubbleCenterLocalZ
        : (this.rubbleMinLocalZ + this.rubbleMaxLocalZ) * 0.5
      this.rubbleHalfD = Number.isFinite(spec.rubbleHalfD)
        ? spec.rubbleHalfD
        : (this.rubbleMaxLocalZ - this.rubbleMinLocalZ) * 0.5
      this.dangerHalfW = Number.isFinite(spec.dangerHalfW)
        ? spec.dangerHalfW
        : resolved.dangerHalfW
      this.dangerMinLocalZ = Number.isFinite(spec.dangerMinLocalZ)
        ? spec.dangerMinLocalZ
        : resolved.dangerMinLocalZ
      this.dangerMaxLocalZ = Number.isFinite(spec.dangerMaxLocalZ)
        ? spec.dangerMaxLocalZ
        : resolved.dangerMaxLocalZ
      this.triggerHalfW = Number.isFinite(spec.triggerHalfW)
        ? spec.triggerHalfW
        : resolved.triggerHalfW
      this.triggerMinLocalZ = Number.isFinite(spec.triggerMinLocalZ)
        ? spec.triggerMinLocalZ
        : resolved.triggerMinLocalZ
      this.triggerMaxLocalZ = Number.isFinite(spec.triggerMaxLocalZ)
        ? spec.triggerMaxLocalZ
        : resolved.triggerMaxLocalZ
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
      this.corridorAxis = spec.corridorAxis || resolved.corridorAxis
      this.lateralOffset = Number.isFinite(spec.lateralOffset)
        ? spec.lateralOffset
        : resolved.lateralOffset
      this.minLocalX = Number.isFinite(spec.minLocalX) ? spec.minLocalX : resolved.minLocalX
      this.maxLocalX = Number.isFinite(spec.maxLocalX) ? spec.maxLocalX : resolved.maxLocalX
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
      this.fallenLocalZ = Number.isFinite(spec.fallenLocalZ)
        ? spec.fallenLocalZ
        : resolved.fallenLocalZ
      this.clearedLocalZ = Number.isFinite(spec.clearedLocalZ)
        ? spec.clearedLocalZ
        : resolved.clearedLocalZ
      this.clearedHalfD = Number.isFinite(spec.clearedHalfD)
        ? spec.clearedHalfD
        : resolved.clearedHalfD
      this.triggerMinLocalX = Number.isFinite(spec.triggerMinLocalX)
        ? spec.triggerMinLocalX
        : resolved.triggerMinLocalX
      this.triggerMaxLocalX = Number.isFinite(spec.triggerMaxLocalX)
        ? spec.triggerMaxLocalX
        : resolved.triggerMaxLocalX
      this.triggerHalfD = Number.isFinite(spec.triggerHalfD)
        ? spec.triggerHalfD
        : resolved.triggerHalfD
      this.dangerMinLocalX = Number.isFinite(spec.dangerMinLocalX)
        ? spec.dangerMinLocalX
        : resolved.dangerMinLocalX
      this.dangerMaxLocalX = Number.isFinite(spec.dangerMaxLocalX)
        ? spec.dangerMaxLocalX
        : resolved.dangerMaxLocalX
      this.dangerHalfD = Number.isFinite(spec.dangerHalfD)
        ? spec.dangerHalfD
        : resolved.dangerHalfD
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
      this.oppositeWallSide =
        spec.oppositeWallSide !== undefined ? spec.oppositeWallSide : resolved.oppositeWallSide
      this.oppositeWallRow = Number.isInteger(spec.oppositeWallRow)
        ? spec.oppositeWallRow
        : resolved.oppositeWallRow
      this.oppositeWallCol = Number.isInteger(spec.oppositeWallCol)
        ? spec.oppositeWallCol
        : resolved.oppositeWallCol
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
      this.dangerHalfW = Number.isFinite(spec.dangerHalfW)
        ? spec.dangerHalfW
        : resolved.dangerHalfW
      this.dangerHalfD = Number.isFinite(spec.dangerHalfD)
        ? spec.dangerHalfD
        : resolved.dangerHalfD
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
      this.steamDangerCenterLocalX = Number.isFinite(spec.dangerCenterLocalX)
        ? spec.dangerCenterLocalX
        : resolved.dangerCenterLocalX
      this.steamDangerHalfW = Number.isFinite(spec.dangerHalfW)
        ? spec.dangerHalfW
        : resolved.dangerHalfW
      this.steamDangerMinLocalZ = Number.isFinite(spec.dangerMinLocalZ)
        ? spec.dangerMinLocalZ
        : resolved.dangerMinLocalZ
      this.steamDangerMaxLocalZ = Number.isFinite(spec.dangerMaxLocalZ)
        ? spec.dangerMaxLocalZ
        : resolved.dangerMaxLocalZ
    } else if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      const resolved = resolveElectricalMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.wallSide || null
      )
      if (spec.mountType === 'wall' || spec.mountType === 'ceiling') {
        this.mountType = spec.mountType
        this.wallSide = spec.wallSide !== undefined ? spec.wallSide : resolved.wallSide
        this.wallRow = Number.isInteger(spec.wallRow) ? spec.wallRow : resolved.wallRow
        this.wallCol = Number.isInteger(spec.wallCol) ? spec.wallCol : resolved.wallCol
        this.wallYaw = Number.isFinite(spec.wallYaw) ? spec.wallYaw : resolved.wallYaw
        this.localDischargeOffset = spec.localDischargeOffset
          ? { ...spec.localDischargeOffset }
          : { ...resolved.localDischargeOffset }
        this.localJunctionOffset = spec.localJunctionOffset
          ? { ...spec.localJunctionOffset }
          : { ...resolved.localJunctionOffset }
        this.localBreakerOffset = spec.localBreakerOffset
          ? { ...spec.localBreakerOffset }
          : { ...resolved.localBreakerOffset }
      } else {
        this.mountType = resolved.mountType
        this.wallSide = resolved.wallSide
        this.wallRow = resolved.wallRow
        this.wallCol = resolved.wallCol
        this.wallYaw = resolved.wallYaw
        this.localDischargeOffset = { ...resolved.localDischargeOffset }
        this.localJunctionOffset = { ...resolved.localJunctionOffset }
        this.localBreakerOffset = { ...resolved.localBreakerOffset }
      }
    } else if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      const resolved = resolveFloorGrateMount(this.maze?.grid, this.row, this.col)
      if (spec.corridorAxis === 'ns' || spec.corridorAxis === 'ew') {
        this.corridorAxis = spec.corridorAxis
        this.grateYaw = Number.isFinite(spec.grateYaw)
          ? spec.grateYaw
          : spec.corridorAxis === 'ew'
            ? Math.PI * 0.5
            : 0
        this.floorY = Number.isFinite(spec.floorY) ? spec.floorY : 0
      } else {
        this.corridorAxis = resolved.corridorAxis
        this.grateYaw = resolved.grateYaw
        this.floorY = resolved.floorY
      }
      this.localPitOffset = spec.localPitOffset
        ? { ...spec.localPitOffset }
        : { ...resolved.localPitOffset }
      this.pitInnerHalfW = Number.isFinite(spec.pitInnerHalfW)
        ? spec.pitInnerHalfW
        : resolved.pitInnerHalfW
      this.pitInnerHalfD = Number.isFinite(spec.pitInnerHalfD)
        ? spec.pitInnerHalfD
        : resolved.pitInnerHalfD
      this.pitDepth = Number.isFinite(spec.pitDepth) ? spec.pitDepth : resolved.pitDepth
      this.aftermathHalfW = Number.isFinite(spec.aftermathHalfW)
        ? spec.aftermathHalfW
        : resolved.aftermathHalfW
      this.aftermathHalfD = Number.isFinite(spec.aftermathHalfD)
        ? spec.aftermathHalfD
        : resolved.aftermathHalfD
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
        this.localDischargeOffset = {
          x: 0,
          y: WALL_COLLAPSE_CONSTANTS.impactLocalY,
          z: WALL_COLLAPSE_CONSTANTS.impactLocalZ,
        }
      }
      this.aftermathHalfW = Number.isFinite(spec.aftermathHalfW)
        ? spec.aftermathHalfW
        : WALL_COLLAPSE_CONSTANTS.aftermathHalfW
      this.aftermathHalfD = Number.isFinite(spec.aftermathHalfD)
        ? spec.aftermathHalfD
        : WALL_COLLAPSE_CONSTANTS.aftermathHalfD
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
      this.sideSign =
        Number.isFinite(spec.sideSign) && spec.sideSign !== 0
          ? Math.sign(spec.sideSign)
          : resolved.sideSign
      this.aftermathHalfW = Number.isFinite(spec.aftermathHalfW)
        ? spec.aftermathHalfW
        : resolved.aftermathHalfW
      this.aftermathHalfD = Number.isFinite(spec.aftermathHalfD)
        ? spec.aftermathHalfD
        : resolved.aftermathHalfD
    } else if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
      const resolved = resolveSuspendedMachineryMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.swingSide || null
      )
      this.mountType = spec.mountType || resolved.mountType
      this.ceilingStructureType = spec.ceilingStructureType || resolved.ceilingStructureType
      this.ceilingBeamY = Number.isFinite(spec.ceilingBeamY)
        ? spec.ceilingBeamY
        : resolved.ceilingBeamY
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
      this.sideSign =
        Number.isFinite(spec.sideSign) && spec.sideSign !== 0
          ? Math.sign(spec.sideSign)
          : resolved.sideSign
      this.hasSideWall =
        spec.hasSideWall !== undefined ? Boolean(spec.hasSideWall) : Boolean(resolved.hasSideWall)
      this.clearedLocalX = Number.isFinite(spec.clearedLocalX)
        ? spec.clearedLocalX
        : this.sideSign *
          (this.hasSideWall
            ? SUSPENDED_MACHINERY_CONSTANTS.clearedLocalX
            : SUSPENDED_MACHINERY_CONSTANTS.clearedOpenLocalX)
      this.clearedLocalZ = Number.isFinite(spec.clearedLocalZ)
        ? spec.clearedLocalZ
        : this.hasSideWall
          ? SUSPENDED_MACHINERY_CONSTANTS.clearedLocalZ
          : SUSPENDED_MACHINERY_CONSTANTS.clearedOpenLocalZ
      this.aftermathHalfW = Number.isFinite(spec.aftermathHalfW)
        ? spec.aftermathHalfW
        : resolved.aftermathHalfW
      this.aftermathHalfD = Number.isFinite(spec.aftermathHalfD)
        ? spec.aftermathHalfD
        : resolved.aftermathHalfD
      this.aftermathYawOffset = Number.isFinite(spec.aftermathYawOffset)
        ? spec.aftermathYawOffset
        : this.sideSign * SUSPENDED_MACHINERY_CONSTANTS.fallenRy
    } else if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
      const resolved = resolveVentilationDuctMount(
        this.maze?.grid,
        this.row,
        this.col,
        null,
        spec.dropSide || null
      )
      this.mountType = spec.mountType || resolved.mountType
      this.ceilingStructureType = spec.ceilingStructureType || resolved.ceilingStructureType
      this.ceilingBeamY = Number.isFinite(spec.ceilingBeamY)
        ? spec.ceilingBeamY
        : resolved.ceilingBeamY
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
      this.hangerPivotY = Number.isFinite(spec.hangerPivotY)
        ? spec.hangerPivotY
        : resolved.hangerPivotY
      this.ceilingAnchorY = Number.isFinite(spec.ceilingAnchorY)
        ? spec.ceilingAnchorY
        : resolved.ceilingAnchorY
      this.fallenY = Number.isFinite(spec.fallenY) ? spec.fallenY : resolved.fallenY
      this.sideSign =
        Number.isFinite(spec.sideSign) && spec.sideSign !== 0
          ? Math.sign(spec.sideSign)
          : resolved.sideSign
      this.hasSideWall =
        spec.hasSideWall !== undefined ? Boolean(spec.hasSideWall) : Boolean(resolved.hasSideWall)
      this.clearedLocalX = Number.isFinite(spec.clearedLocalX)
        ? spec.clearedLocalX
        : resolved.clearedLocalX
      this.clearedLocalZ = Number.isFinite(spec.clearedLocalZ)
        ? spec.clearedLocalZ
        : resolved.clearedLocalZ
      this.aftermathHalfW = Number.isFinite(spec.aftermathHalfW)
        ? spec.aftermathHalfW
        : resolved.aftermathHalfW
      this.aftermathHalfD = Number.isFinite(spec.aftermathHalfD)
        ? spec.aftermathHalfD
        : resolved.aftermathHalfD
      this.aftermathYawOffset = Number.isFinite(spec.aftermathYawOffset)
        ? spec.aftermathYawOffset
        : resolved.aftermathYawOffset
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
      qualityPreset: this.qualityPreset,
      mountType: this.mountType,
      wallSide: this.wallSide,
      wallYaw: this.wallYaw,
      lateralOffset: this.lateralOffset,
      minLocalX: this.minLocalX,
      maxLocalX: this.maxLocalX,
      uprightHalfW: this.uprightHalfW,
      uprightHalfD: this.uprightHalfD,
      aftermathHalfW: this.aftermathHalfW,
      aftermathHalfD: this.aftermathHalfD,
      fallenLocalZ: this.fallenLocalZ,
      clearedHalfD: this.clearedHalfD,
      collapseYaw: this.collapseYaw,
      localPatchOffset: this.localPatchOffset,
      ceilingSoffitY: this.ceilingSoffitY,
      rubbleHalfW: this.rubbleHalfW,
      rubbleHalfD: this.rubbleHalfD,
      rubbleMinLocalZ: this.rubbleMinLocalZ,
      rubbleMaxLocalZ: this.rubbleMaxLocalZ,
      rubbleCenterLocalZ: this.rubbleCenterLocalZ,
      clearBias: this.clearBias,
      activeDuration: this.config.activeDuration,
      tankYaw: this.tankYaw,
      sideSign: this.sideSign,
      surgeLength: this.surgeLength,
      surgeHalfWidth: this.surgeHalfWidth,
      tankRestY: this.tankRestY,
      machineryYaw: this.machineryYaw,
      machineryRestY: this.machineryRestY,
      ceilingStructureType: this.ceilingStructureType,
      ceilingBeamY: this.ceilingBeamY,
      hangerPivotY: this.hangerPivotY,
      hasSideWall: this.hasSideWall,
      clearedLocalX: this.clearedLocalX,
      clearedLocalZ: this.clearedLocalZ,
      aftermathYawOffset: this.aftermathYawOffset,
      ductYaw: this.ductYaw,
      ductRestY: this.ductRestY,
      fallenY: this.fallenY,
      pipeYaw: this.pipeYaw,
      pipeRestY: this.pipeRestY,
      steamYaw: this.steamYaw,
      pipeMainY: this.pipeMainY,
      ceilingAnchorY: this.ceilingAnchorY,
      corridorAxis: this.corridorAxis,
      grateYaw: this.grateYaw,
      floorY: this.floorY,
      localPitOffset: this.localPitOffset,
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
          const upOff = this.localUprightOffset || {
            x: 0,
            y: ROTTEN_FURNITURE_CONSTANTS.rackHeight * 0.5,
            z: ROTTEN_FURNITURE_CONSTANTS.uprightLocalZ,
          }
          const impOff = this.localDischargeOffset || {
            x: 0,
            y: ROTTEN_FURNITURE_CONSTANTS.impactLocalY,
            z: ROTTEN_FURNITURE_CONSTANTS.fallenLocalZ,
          }
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
          const overOff = this.localOverheadOffset || {
            x: 0,
            y: FALLING_PIPES_CONSTANTS.pipeRestY,
            z: FALLING_PIPES_CONSTANTS.overheadLocalZ,
          }
          const impOff = this.localDischargeOffset || {
            x: 0,
            y: FALLING_PIPES_CONSTANTS.impactLocalY,
            z: FALLING_PIPES_CONSTANTS.impactLocalZ,
          }
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
          const impOff = this.localDischargeOffset || { x: 0.12, y: 1.26, z: 0.0 }
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
          this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING &&
          this.localDischargeOffset
        ) {
          const juncOff = this.localJunctionOffset || this.localDischargeOffset
          const brkOff = this.localBreakerOffset || { x: -0.78, y: 1.32, z: -1.88 }
          this.originWorldPos = {
            x: pos.x + juncOff.x,
            y: juncOff.y,
            z: pos.z + juncOff.z,
          }
          this.breakerWorldPos = {
            x: pos.x + brkOff.x,
            y: brkOff.y,
            z: pos.z + brkOff.z,
          }
          this.dangerWorldPos = {
            x: pos.x + this.localDischargeOffset.x,
            y: this.localDischargeOffset.y,
            z: pos.z + this.localDischargeOffset.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
        } else if (
          this.type === HAZARD_TYPES.WALL_COLLAPSE &&
          this.localDischargeOffset
        ) {
          this.dangerWorldPos = {
            x: pos.x + this.localDischargeOffset.x,
            y: this.localDischargeOffset.y,
            z: pos.z + this.localDischargeOffset.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
        } else if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
          const offX = Number(this.localPitOffset?.x) || 0
          const offZ = Number(this.localPitOffset?.z) || 0
          this.dangerWorldPos = { x: pos.x + offX, y: this.floorY, z: pos.z + offZ }
          this.worldPos = { x: pos.x + offX, y: 0.05, z: pos.z + offZ }
        } else if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
          this.dangerWorldPos = { x: pos.x, y: 0.45, z: pos.z }
          this.worldPos = { x: pos.x, y: 1.25, z: pos.z }
          const lx = (this.sideSign || 1) * WATER_TANK_CONSTANTS.fallenLocalX
          const lz = WATER_TANK_CONSTANTS.fallenLocalZ
          const cosY = Math.cos(this.tankYaw || 0)
          const sinY = Math.sin(this.tankYaw || 0)
          this.fallenTankWorldPos = {
            x: pos.x + lx * cosY + lz * sinY,
            y: WATER_TANK_CONSTANTS.tankFallenY,
            z: pos.z - lx * sinY + lz * cosY,
          }
        } else if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
          const fallbackZ = SUSPENDED_MACHINERY_CONSTANTS.impactLocalZ
          const off = this.localDischargeOffset || { x: 0, y: 0.75, z: fallbackZ }
          this.originWorldPos = { x: pos.x, y: 1.2, z: pos.z }
          this.dangerWorldPos = {
            x: pos.x + off.x,
            y: off.y,
            z: pos.z + off.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
          const lx = (this.sideSign || 1) * SUSPENDED_MACHINERY_CONSTANTS.fallenLocalX
          const lz = SUSPENDED_MACHINERY_CONSTANTS.fallenLocalZ
          const cosY = Math.cos(this.machineryYaw || 0)
          const sinY = Math.sin(this.machineryYaw || 0)
          this.fallenMachineryWorldPos = {
            x: pos.x + lx * cosY + lz * sinY,
            y: SUSPENDED_MACHINERY_CONSTANTS.fallenY,
            z: pos.z - lx * sinY + lz * cosY,
          }
        } else if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
          const off = this.localDischargeOffset || { x: 0, y: 0.65, z: 0.56 }
          this.originWorldPos = { x: pos.x, y: 1.2, z: pos.z }
          this.dangerWorldPos = {
            x: pos.x + off.x,
            y: off.y,
            z: pos.z + off.z,
          }
          this.worldPos = { ...this.dangerWorldPos }
          const lx = (this.sideSign || 1) * VENTILATION_DUCT_CONSTANTS.fallenLocalX
          const lz = VENTILATION_DUCT_CONSTANTS.fallenLocalZ
          const cosY = Math.cos(this.ductYaw || 0)
          const sinY = Math.sin(this.ductYaw || 0)
          this.fallenDuctWorldPos = {
            x: pos.x + lx * cosY + lz * sinY,
            y: VENTILATION_DUCT_CONSTANTS.fallenY,
            z: pos.z - lx * sinY + lz * cosY,
          }
        } else {
          this.worldPos = { x: pos.x, y: 0.5, z: pos.z }
        }
      }
    }
    this._rubblePieces = []
    this._rubblePieceById = new Map()
    this._smallRubbleFragments = []
    this.furnitureDispLocalX = 0
    this.furnitureDispLocalZ = 0
    this.isFurnitureHighlighted = false
    this._furnitureHighlightMatMap = new Map()
    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
      this._initCeilingRubblePieces()
    } else if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      this._initRottenFurnitureHandling()
    }
    this._rebuildColliderEntries()
    this._syncColliderStates(0)
    updateHazardVisualState(this.mesh, this.state, 0)
  }

  _initRottenFurnitureHandling() {
    this.furnitureDispLocalX = 0
    this.furnitureDispLocalZ = 0
    this.isFurnitureHighlighted = false
    const meshes = this.mesh?.userData?.furnitureInteractiveMeshes
    if (Array.isArray(meshes)) {
      for (let i = 0; i < meshes.length; i += 1) {
        const m = meshes[i]
        if (m && m.userData) {
          m.userData.hazardId = this.id
          m.userData.isRottenFurniturePiece = true
          if (!m.userData.baseMaterial) {
            m.userData.baseMaterial = m.material
          }
        }
      }
    }
  }

  isCollapsedForFurnitureHandling() {
    return Boolean(
      this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE &&
        !this.isDisposed &&
        (this.isPermanentlyCollapsed || this.state === HAZARD_STATES.DISABLED)
    )
  }

  getFurnitureInteractiveMeshes() {
    if (this.type !== HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE || this.isDisposed) {
      return []
    }
    return this.mesh?.userData?.furnitureInteractiveMeshes || []
  }

  getFurniturePose(
    overrideDispX = this.furnitureDispLocalX,
    overrideDispZ = this.furnitureDispLocalZ
  ) {
    if (this.type !== HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) return null
    const data = this.mesh?.userData || {}
    const params = {
      pivotX: Number.isFinite(data.pivotX) ? data.pivotX : this.lateralOffset || 0,
      spanHalfW: Number.isFinite(data.spanHalfW)
        ? data.spanHalfW
        : this.uprightHalfW ?? ROTTEN_FURNITURE_CONSTANTS.halfSpanOpen,
      rackHeight: Number.isFinite(data.rackHeight)
        ? data.rackHeight
        : ROTTEN_FURNITURE_CONSTANTS.rackHeight,
      rackDepth: Number.isFinite(data.rackDepth)
        ? data.rackDepth
        : ROTTEN_FURNITURE_CONSTANTS.rackDepth,
      fallenPivotZ: Number.isFinite(data.fallenPivotZ)
        ? data.fallenPivotZ
        : ROTTEN_FURNITURE_CONSTANTS.fallenPivotZ,
      clearedPivotZ: Number.isFinite(data.clearedPivotZ)
        ? data.clearedPivotZ
        : ROTTEN_FURNITURE_CONSTANTS.clearedPivotZ,
      collapsedPitch: Number.isFinite(data.collapsedPitch)
        ? data.collapsedPitch
        : Math.PI * 0.5,
      fallenYaw: Number.isFinite(data.fallenYaw) ? data.fallenYaw : 0.014,
      clearedPitch: Number.isFinite(data.clearedPitch) ? data.clearedPitch : 0.016,
      clearedYaw: Number.isFinite(data.clearedYaw) ? data.clearedYaw : -0.006,
      clearedRoll: Number.isFinite(data.clearedRoll) ? data.clearedRoll : -0.005,
    }
    const pose = computeRottenFurniturePose(params, overrideDispX, overrideDispZ)
    const baseX = this.cellWorldPos ? this.cellWorldPos.x : this.worldPos?.x || 0
    const baseZ = this.cellWorldPos ? this.cellWorldPos.z : this.worldPos?.z || 0
    const wallYaw = Number.isFinite(this.wallYaw) ? this.wallYaw : 0
    const cosY = Math.cos(wallYaw)
    const sinY = Math.sin(wallYaw)
    pose.baseX = baseX
    pose.baseZ = baseZ
    pose.wallYaw = wallYaw
    pose.cosYaw = cosY
    pose.sinYaw = sinY
    pose.worldCx = baseX + pose.centerLocalX * cosY + pose.centerLocalZ * sinY
    pose.worldCz = baseZ - pose.centerLocalX * sinY + pose.centerLocalZ * cosY
    return pose
  }

  setFurnitureDisplacement(dispLocalX = 0, dispLocalZ = 0) {
    if (this.isDisposed || this.type !== HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      return null
    }
    const allowedMinX = Number.isFinite(this.minLocalX) ? this.minLocalX : -2.6
    const allowedMaxX = Number.isFinite(this.maxLocalX) ? this.maxLocalX : 2.6
    const halfW = this.uprightHalfW ?? ROTTEN_FURNITURE_CONSTANTS.halfSpanOpen
    const baseLat = Number.isFinite(this.lateralOffset) ? this.lateralOffset : 0
    const minDispX = allowedMinX + halfW - baseLat - 0.15
    const maxDispX = allowedMaxX - halfW - baseLat + 0.15
    const clampedDispX = Math.max(
      Math.min(minDispX, -0.45),
      Math.min(Math.max(maxDispX, 0.45), Number(dispLocalX) || 0)
    )
    const clampedDispZ = Math.max(
      ROTTEN_FURNITURE_HANDLING_LIMITS.minDispZ,
      Math.min(ROTTEN_FURNITURE_HANDLING_LIMITS.maxDispZ, Number(dispLocalZ) || 0)
    )

    this.furnitureDispLocalX = clampedDispX
    this.furnitureDispLocalZ = clampedDispZ
    const pose = this.getFurniturePose(clampedDispX, clampedDispZ)
    const isWallFlushCleared =
      clampedDispZ <= ROTTEN_FURNITURE_HANDLING_LIMITS.clearedThresholdDispZ
    this.isAftermathCleared = isWallFlushCleared

    if (this.mesh?.userData) {
      this.mesh.userData.furnitureDispLocalX = pose.dispLocalX
      this.mesh.userData.furnitureDispLocalZ = pose.dispLocalZ
      this.mesh.userData.isAftermathCleared = isWallFlushCleared
      updateHazardVisualState(this.mesh, this.state, 1)
      this.mesh.updateMatrixWorld(true)
    }

    const activeProgress =
      this.state === HAZARD_STATES.ACTIVE && this.config.activeDuration > 0
        ? Math.min(1, this.timer / this.config.activeDuration)
        : this.state === HAZARD_STATES.DISABLED || this.isPermanentlyCollapsed
          ? 1
          : 0

    const cell = this.maze
      ? worldToGrid(pose.worldCx, pose.worldCz, this.maze)
      : null
    const colRow = cell ? cell.row : this.row
    const colCol = cell ? cell.col : this.col

    for (let i = 0; i < this._colliderEntries.length; i += 1) {
      const entry = this._colliderEntries[i]
      if (entry.phase === 'aftermath' || entry.phase === 'cleared') {
        entry.cx = pose.worldCx
        entry.cz = pose.worldCz
        entry.halfW = pose.halfW
        entry.halfD = pose.halfD
        entry.yaw = pose.wallYaw
        entry.row = colRow
        entry.col = colCol
        entry.allowCorridorBlock =
          !isWallFlushCleared || pose.corridorClearance < 1.65
      }
      entry.enabled = this._shouldColliderBeEnabled(entry, activeProgress)
    }

    this._colliderVersion += 1
    return pose
  }

  setFurnitureHighlighted(highlighted = false) {
    if (this.isDisposed || this.type !== HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      return false
    }
    const next = Boolean(highlighted)
    if (this.isFurnitureHighlighted === next) return next
    this.isFurnitureHighlighted = next

    const meshes = this.getFurnitureInteractiveMeshes()
    for (let i = 0; i < meshes.length; i += 1) {
      const m = meshes[i]
      if (!m || !m.isMesh) continue
      const baseMat = m.userData?.baseMaterial || m.material
      if (!baseMat) continue
      if (!next) {
        m.material = baseMat
      } else {
        let hiMat = this._furnitureHighlightMatMap.get(baseMat)
        if (!hiMat && typeof baseMat.clone === 'function') {
          hiMat = baseMat.clone()
          if (hiMat.emissive && typeof hiMat.emissive.setHex === 'function') {
            hiMat.emissive.setHex(0x6b5328)
            hiMat.emissiveIntensity = 0.36
          } else if (hiMat.color && typeof hiMat.color.offsetHSL === 'function') {
            hiMat.color.offsetHSL(0, 0.05, 0.12)
          }
          this._furnitureHighlightMatMap.set(baseMat, hiMat)
        }
        if (hiMat) {
          m.material = hiMat
        }
      }
    }
    return next
  }

  _initCeilingRubblePieces() {
    this._rubblePieces = []
    this._rubblePieceById.clear()
    this._smallRubbleFragments = []
    const data = this.mesh?.userData
    const meshes = data?.ceilingDebrisMeshes
    const configs = data?.ceilingDebrisConfigs
    if (!Array.isArray(meshes) || !Array.isArray(configs)) return

    const baseX = this.cellWorldPos ? this.cellWorldPos.x : this.worldPos?.x || 0
    const baseZ = this.cellWorldPos ? this.cellWorldPos.z : this.worldPos?.z || 0
    const patchX = Number(this.localPatchOffset?.x) || 0
    const patchZ = Number(this.localPatchOffset?.z) || 0
    const originX = baseX + patchX
    const originZ = baseZ + patchZ
    const yaw = Number.isFinite(this.collapseYaw) ? this.collapseYaw : 0
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)

    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i]
      const cfg = configs[i]
      if (!mesh || !cfg) continue
      const pieceId = `${this.id}:rubble-${i}`
      if (mesh.userData) {
        mesh.userData.hazardId = this.id
        mesh.userData.pieceId = pieceId
        mesh.userData.manualState = 'fallen'
      }

      const wx = originX + cfg.restX * cosY + cfg.restZ * sinY
      const wz = originZ - cfg.restX * sinY + cfg.restZ * cosY
      const wy = cfg.restY
      const worldYaw = yaw + cfg.restRotY
      const cell = this.maze ? worldToGrid(wx, wz, this.maze) : null
      const pieceRow = cell ? cell.row : this.row
      const pieceCol = cell ? cell.col : this.col

      const entry = {
        pieceId,
        colliderId: pieceId,
        hazardId: this.id,
        pieceIndex: i,
        mesh,
        cfg,
        isLargeRubble: Boolean(cfg.isLargeRubble),
        isSmallFragment: Boolean(cfg.isSmallFragment),
        state: 'fallen',
        restWorldPos: { x: wx, y: wy, z: wz },
        restWorldYaw: worldYaw,
        restRow: pieceRow,
        restCol: pieceCol,
        worldPos: { x: wx, y: wy, z: wz },
        worldYaw,
        row: pieceRow,
        col: pieceCol,
        halfW: cfg.halfX,
        halfD: cfg.halfZ,
        halfY: cfg.halfY,
      }

      if (entry.isLargeRubble) {
        this._rubblePieces.push(entry)
        this._rubblePieceById.set(pieceId, entry)
      } else {
        this._smallRubbleFragments.push(entry)
      }
    }
  }

  isCollapsedForRubbleHandling() {
    return Boolean(
      this.type === HAZARD_TYPES.CEILING_COLLAPSE &&
        !this.isDisposed &&
        !this.isAftermathCleared &&
        (this.isPermanentlyCollapsed || this.state === HAZARD_STATES.DISABLED)
    )
  }

  getRubblePieces() {
    return this._rubblePieces
  }

  getRubblePiece(pieceId) {
    if (!pieceId) return null
    return this._rubblePieceById.get(pieceId) || null
  }

  setRubblePieceState(pieceId, nextState, worldTransform = null) {
    if (this.isDisposed || this.type !== HAZARD_TYPES.CEILING_COLLAPSE) return false
    const piece = this._rubblePieceById.get(pieceId)
    if (!piece) return false

    const prevState = piece.state
    piece.state = nextState
    if (piece.mesh?.userData) {
      piece.mesh.userData.manualState = nextState
    }

    if (worldTransform) {
      if (Number.isFinite(worldTransform.x)) piece.worldPos.x = worldTransform.x
      if (Number.isFinite(worldTransform.y)) piece.worldPos.y = worldTransform.y
      if (Number.isFinite(worldTransform.z)) piece.worldPos.z = worldTransform.z
      if (Number.isFinite(worldTransform.yaw)) piece.worldYaw = worldTransform.yaw
      if (this.maze) {
        const cell = worldToGrid(piece.worldPos.x, piece.worldPos.z, this.maze)
        if (cell) {
          piece.row = cell.row
          piece.col = cell.col
        }
      }
    }

    // Grouped non-tedious small debris cleanup: lifting a large slab naturally nudges
    // nearby small plaster chips toward the nearest flanking corridor wall edge.
    if (nextState === 'carried' && prevState !== 'carried' && this._smallRubbleFragments.length > 0) {
      const refX = piece.worldPos.x
      const refZ = piece.worldPos.z
      let sweptAny = false
      for (let i = 0; i < this._smallRubbleFragments.length; i += 1) {
        const frag = this._smallRubbleFragments[i]
        if (!frag || frag.state === 'swept') continue
        const dist = Math.hypot(frag.restWorldPos.x - refX, frag.restWorldPos.z - refZ)
        if (dist <= 1.35) {
          frag.state = 'swept'
          if (frag.mesh?.userData) {
            frag.mesh.userData.manualState = 'swept'
          }
          frag.mesh.position.set(frag.cfg.clearedX, frag.cfg.clearedY, frag.cfg.clearedZ)
          frag.mesh.rotation.set(0.04, frag.cfg.restRotY + 0.6, -0.04)
          frag.mesh.scale.set(frag.cfg.sx * 0.82, frag.cfg.sy * 0.56, frag.cfg.sz * 0.82)
          sweptAny = true
        }
      }
      if (sweptAny && this.mesh) {
        this.mesh.updateMatrixWorld(true)
      }
    }

    // Synchronize ONLY this piece's dynamic OBB collider entry (never disturb neighboring slabs)
    const activeProgress =
      this.state === HAZARD_STATES.ACTIVE && this.config.activeDuration > 0
        ? Math.min(1, this.timer / this.config.activeDuration)
        : this.state === HAZARD_STATES.DISABLED || this.isPermanentlyCollapsed
          ? 1
          : 0

    for (let i = 0; i < this._colliderEntries.length; i += 1) {
      const entry = this._colliderEntries[i]
      if (entry.pieceId !== pieceId) continue
      entry.cx = piece.worldPos.x
      entry.cz = piece.worldPos.z
      entry.yaw = piece.worldYaw
      entry.row = piece.row
      entry.col = piece.col
      entry.enabled = this._shouldColliderBeEnabled(entry, activeProgress)
      break
    }

    this._colliderVersion += 1
    return true
  }

  _buildDefaultInteractionHandler() {
    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
      // Ceiling Collapse rubble is handled manually via mouse targeting (left-click pickup /
      // right-click placement); F-key interaction and F-key prompts are intentionally disabled.
      return null
    }
    if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      // Rotten Furniture Collapse is handled manually via mouse grip & WASD physical pushing/dragging;
      // instant F-key teleportation and F-key prompts are intentionally disabled.
      return null
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
          agent.state === HAZARD_STATES.ACTIVE && !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'seal_steam_pipe',
          label: 'Seal Steam Pipe',
          shortLabel: 'Seal',
        }),
        onInteract: () => ({
          handled: true,
          action: 'seal_steam_pipe',
          disableHazard: true,
          clearAftermath: true,
          emitSoundRange: 4.0,
        }),
      }
    }
    if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      return {
        range: 2.35,
        canInteract: (agent) =>
          agent.state === HAZARD_STATES.ACTIVE && !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'insulate_wiring',
          label: 'Insulate Exposed Wiring',
          shortLabel: 'Insulate',
        }),
        onInteract: () => ({
          handled: true,
          action: 'insulate_wiring',
          disableHazard: true,
          clearAftermath: true,
          emitSoundRange: 4.0,
        }),
      }
    }
    if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      return {
        range: 2.2,
        canInteract: (agent, ctx) => {
          const collapsed =
            agent.state === HAZARD_STATES.DISABLED || agent.isPermanentlyCollapsed
          if (!collapsed || agent.isAftermathCleared) {
            return false
          }
          if (
            ctx?.playerWorldPos &&
            agent._isPointInGrateArea(ctx.playerWorldPos.x, ctx.playerWorldPos.z, 0.02)
          ) {
            return false
          }
          return true
        },
        getPrompt: () => ({
          action: 'secure_floor_opening',
          label: 'Secure Floor Opening',
          shortLabel: 'Secure',
        }),
        onInteract: () => ({
          handled: true,
          action: 'secure_floor_opening',
          clearAftermath: true,
          emitSoundRange: 4.5,
        }),
      }
    }
    if (this.type === HAZARD_TYPES.WALL_COLLAPSE) {
      return {
        range: 2.25,
        canInteract: (agent) =>
          (agent.state === HAZARD_STATES.DISABLED || agent.isPermanentlyCollapsed) &&
          !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'clear_rubble',
          label: 'Clear Fallen Masonry',
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
    if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
      return {
        range: 2.25,
        canInteract: (agent) =>
          (agent.state === HAZARD_STATES.DISABLED || agent.isPermanentlyCollapsed) &&
          !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'clear_tank',
          label: 'Move Fallen Tank',
          shortLabel: 'Move',
        }),
        onInteract: () => ({
          handled: true,
          action: 'clear_tank',
          clearAftermath: true,
          emitSoundRange: 4.5,
        }),
      }
    }
    if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
      return {
        range: 2.25,
        canInteract: (agent) =>
          (agent.state === HAZARD_STATES.DISABLED || agent.isPermanentlyCollapsed) &&
          !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'clear_machinery',
          label: 'Move Fallen Machinery',
          shortLabel: 'Move',
        }),
        onInteract: () => ({
          handled: true,
          action: 'clear_machinery',
          clearAftermath: true,
          emitSoundRange: 4.5,
        }),
      }
    }
    if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
      return {
        range: 2.25,
        canInteract: (agent) =>
          (agent.state === HAZARD_STATES.DISABLED || agent.isPermanentlyCollapsed) &&
          !agent.isAftermathCleared,
        getPrompt: () => ({
          action: 'clear_duct',
          label: 'Move Fallen Duct',
          shortLabel: 'Move',
        }),
        onInteract: () => ({
          handled: true,
          action: 'clear_duct',
          clearAftermath: true,
          emitSoundRange: 4.5,
        }),
      }
    }
    return null
  }

  _isPointInGrateArea(px, pz, pad = 0) {
    if (!this.dangerWorldPos || !Number.isFinite(px) || !Number.isFinite(pz)) {
      return false
    }
    const dx = px - this.dangerWorldPos.x
    const dz = pz - this.dangerWorldPos.z
    const yaw = Number.isFinite(this.grateYaw) ? this.grateYaw : 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    const hw = (this.pitInnerHalfW ?? FLOOR_GRATE_CONSTANTS.pitInnerHalfW) + pad
    const hd = (this.pitInnerHalfD ?? FLOOR_GRATE_CONSTANTS.pitInnerHalfD) + pad
    return Math.abs(lx) <= hw && Math.abs(lz) <= hd
  }

  _isPointInWallCollapseArea(px, pz, pad = 0) {
    const base = this.cellWorldPos || this.dangerWorldPos
    if (!base || !Number.isFinite(px) || !Number.isFinite(pz)) {
      return false
    }
    const dx = px - base.x
    const dz = pz - base.z
    const yaw = Number.isFinite(this.wallYaw) ? this.wallYaw : 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    const hw = (this.config.dangerHalfW ?? WALL_COLLAPSE_CONSTANTS.dangerHalfW) + pad
    const minZ = (this.config.dangerMinLocalZ ?? WALL_COLLAPSE_CONSTANTS.dangerMinLocalZ) - pad
    const maxZ = (this.config.dangerMaxLocalZ ?? WALL_COLLAPSE_CONSTANTS.dangerMaxLocalZ) + pad
    return Math.abs(lx) <= hw && lz >= minZ && lz <= maxZ
  }

  _isPointInSteamPlumeArea(px, pz, pad = 0) {
    const base = this.cellWorldPos || this.dangerWorldPos
    if (!base || !Number.isFinite(px) || !Number.isFinite(pz)) {
      return false
    }
    const dx = px - base.x
    const dz = pz - base.z
    const yaw = Number.isFinite(this.steamYaw) ? this.steamYaw : 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    const centerX = Number.isFinite(this.steamDangerCenterLocalX)
      ? this.steamDangerCenterLocalX
      : STEAM_PIPE_CONSTANTS.dangerCenterLocalX
    const hw = Number.isFinite(this.steamDangerHalfW)
      ? this.steamDangerHalfW
      : STEAM_PIPE_CONSTANTS.dangerHalfW
    const minZ = Number.isFinite(this.steamDangerMinLocalZ)
      ? this.steamDangerMinLocalZ
      : this.mountType === 'ceiling'
        ? STEAM_PIPE_CONSTANTS.ceilingDangerMinLocalZ
        : STEAM_PIPE_CONSTANTS.dangerMinLocalZ
    const maxZ = Number.isFinite(this.steamDangerMaxLocalZ)
      ? this.steamDangerMaxLocalZ
      : STEAM_PIPE_CONSTANTS.dangerMaxLocalZ
    const safePad = Math.max(0, Number.isFinite(pad) ? pad : 0)
    // Transverse span [minZ, maxZ] covers the entire usable corridor width [-2.0, +2.0]
    // from wall to wall without extending through solid corridor walls; apply player
    // footprint contact margin along the open longitudinal walking axis (localX).
    return Math.abs(lx - centerX) <= hw + safePad && lz >= minZ && lz <= maxZ
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
      if (Array.isArray(this._rubblePieces) && this._rubblePieces.length > 0) {
        return this._rubblePieces.map((piece) => ({
          id: piece.colliderId,
          pieceId: piece.pieceId,
          phase: 'rubble_piece',
          activateProgress: 0.46,
          kind: 'obb',
          cx: piece.worldPos.x,
          cz: piece.worldPos.z,
          halfW: piece.halfW,
          halfD: piece.halfD,
          yaw: piece.worldYaw,
          row: piece.row,
          col: piece.col,
          allowCorridorBlock: true,
        }))
      }
      const baseX = this.cellWorldPos ? this.cellWorldPos.x : this.worldPos?.x || 0
      const baseZ = this.cellWorldPos ? this.cellWorldPos.z : this.worldPos?.z || 0
      const patchX = Number(this.localPatchOffset?.x) || 0
      const patchZ = Number(this.localPatchOffset?.z) || 0
      const yaw = Number.isFinite(this.collapseYaw) ? this.collapseYaw : 0
      const centerLz = Number.isFinite(this.rubbleCenterLocalZ) ? this.rubbleCenterLocalZ : 0
      const cx = baseX + patchX + centerLz * Math.sin(yaw)
      const cz = baseZ + patchZ + centerLz * Math.cos(yaw)
      return [
        {
          id: `${this.id}:aftermath-rubble`,
          phase: 'aftermath',
          activateProgress: 0.46,
          kind: 'obb',
          cx,
          cz,
          halfW: this.rubbleHalfW ?? CEILING_COLLAPSE_CONSTANTS.rubbleHalfW,
          halfD: this.rubbleHalfD ?? CEILING_COLLAPSE_CONSTANTS.rubbleHalfD,
          baseYaw: yaw,
          yawOffset: 0,
          allowCorridorBlock: true,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      const lat = Number.isFinite(this.lateralOffset) ? this.lateralOffset : 0
      const upHalfW = this.uprightHalfW ?? ROTTEN_FURNITURE_CONSTANTS.halfSpanOpen
      const upHalfD = this.uprightHalfD ?? ROTTEN_FURNITURE_CONSTANTS.uprightHalfD
      const aftHalfW = this.aftermathHalfW ?? upHalfW
      const aftHalfD = this.aftermathHalfD ?? ROTTEN_FURNITURE_CONSTANTS.aftermathHalfD
      const fallenLz = this.fallenLocalZ ?? ROTTEN_FURNITURE_CONSTANTS.fallenLocalZ
      const clearedLz = this.clearedLocalZ ?? ROTTEN_FURNITURE_CONSTANTS.clearedLocalZ
      const clearedHd = this.clearedHalfD ?? ROTTEN_FURNITURE_CONSTANTS.clearedHalfD
      return [
        {
          id: `${this.id}:dormant-furniture`,
          phase: 'dormant',
          activateProgress: 0.42,
          kind: 'obb',
          localX: lat,
          localZ: ROTTEN_FURNITURE_CONSTANTS.uprightLocalZ,
          halfW: upHalfW,
          halfD: upHalfD,
          baseYaw: this.wallYaw,
          yawOffset: 0,
        },
        {
          id: `${this.id}:aftermath-furniture`,
          phase: 'aftermath',
          activateProgress: 0.42,
          kind: 'obb',
          localX: lat,
          localZ: fallenLz,
          halfW: aftHalfW,
          halfD: aftHalfD,
          baseYaw: this.wallYaw,
          yawOffset: 0,
          allowCorridorBlock: true,
        },
        {
          id: `${this.id}:cleared-furniture`,
          phase: 'cleared',
          kind: 'obb',
          localX: lat,
          localZ: clearedLz,
          halfW: upHalfW,
          halfD: clearedHd,
          baseYaw: this.wallYaw,
          yawOffset: 0,
          allowCorridorBlock: false,
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
          localZ: FALLING_PIPES_CONSTANTS.impactLocalZ,
          halfW: this.aftermathHalfW ?? FALLING_PIPES_CONSTANTS.aftermathHalfW,
          halfD: this.aftermathHalfD ?? FALLING_PIPES_CONSTANTS.aftermathHalfD,
          baseYaw: this.pipeYaw,
          yawOffset: 0,
          allowCorridorBlock: true,
          traversable: true,
          stepHeight: FALLING_PIPES_CONSTANTS.stepHeight,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      const baseX = this.cellWorldPos ? this.cellWorldPos.x : this.worldPos?.x || 0
      const baseZ = this.cellWorldPos ? this.cellWorldPos.z : this.worldPos?.z || 0
      const offX = Number(this.localPitOffset?.x) || 0
      const offZ = Number(this.localPitOffset?.z) || 0
      return [
        {
          id: `${this.id}:aftermath-pit`,
          phase: 'aftermath',
          activateProgress: 0.04,
          kind: 'obb',
          cx: baseX + offX,
          cz: baseZ + offZ,
          halfW: this.aftermathHalfW ?? FLOOR_GRATE_CONSTANTS.colliderHalfW,
          halfD: this.aftermathHalfD ?? FLOOR_GRATE_CONSTANTS.colliderHalfD,
          baseYaw: this.grateYaw,
          yawOffset: 0,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.WALL_COLLAPSE) {
      return [
        {
          id: `${this.id}:aftermath-rubble`,
          phase: 'aftermath',
          activateProgress: 0.48,
          kind: 'obb',
          localX: 0,
          localZ: WALL_COLLAPSE_CONSTANTS.aftermathLocalZ,
          halfW: this.aftermathHalfW ?? WALL_COLLAPSE_CONSTANTS.aftermathHalfW,
          halfD: this.aftermathHalfD ?? WALL_COLLAPSE_CONSTANTS.aftermathHalfD,
          baseYaw: this.wallYaw,
          yawOffset: 0,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
      return [
        {
          id: `${this.id}:aftermath-tank`,
          phase: 'aftermath',
          activateProgress: WATER_TANK_CONSTANTS.impactProgress,
          kind: 'obb',
          localX: (this.sideSign || 1) * WATER_TANK_CONSTANTS.fallenLocalX,
          localZ: WATER_TANK_CONSTANTS.fallenLocalZ,
          halfW: this.aftermathHalfW ?? WATER_TANK_CONSTANTS.aftermathHalfW,
          halfD: this.aftermathHalfD ?? WATER_TANK_CONSTANTS.aftermathHalfD,
          baseYaw: this.tankYaw,
          yawOffset: 0,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
      return [
        {
          id: `${this.id}:aftermath-machinery`,
          phase: 'aftermath',
          activateProgress: SUSPENDED_MACHINERY_CONSTANTS.impactProgress,
          kind: 'obb',
          localX: (this.sideSign || 1) * SUSPENDED_MACHINERY_CONSTANTS.fallenLocalX,
          localZ: SUSPENDED_MACHINERY_CONSTANTS.fallenLocalZ,
          halfW: this.aftermathHalfW ?? SUSPENDED_MACHINERY_CONSTANTS.aftermathHalfW,
          halfD: this.aftermathHalfD ?? SUSPENDED_MACHINERY_CONSTANTS.aftermathHalfD,
          baseYaw: this.machineryYaw,
          yawOffset: Number.isFinite(this.aftermathYawOffset)
            ? this.aftermathYawOffset
            : (this.sideSign || 1) * SUSPENDED_MACHINERY_CONSTANTS.fallenRy,
        },
      ]
    }
    if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
      const sSign = this.sideSign || 1
      const isCleared = Boolean(this.isAftermathCleared)
      return [
        {
          id: `${this.id}:aftermath-duct`,
          phase: 'aftermath',
          activateProgress: VENTILATION_DUCT_CONSTANTS.impactProgress,
          kind: 'obb',
          localX: isCleared
            ? this.clearedLocalX
            : sSign * VENTILATION_DUCT_CONSTANTS.fallenLocalX,
          localZ: isCleared ? this.clearedLocalZ : VENTILATION_DUCT_CONSTANTS.fallenLocalZ,
          halfW: this.aftermathHalfW ?? VENTILATION_DUCT_CONSTANTS.aftermathHalfW,
          halfD: this.aftermathHalfD ?? VENTILATION_DUCT_CONSTANTS.aftermathHalfD,
          baseYaw: this.ductYaw,
          yawOffset: Number.isFinite(this.aftermathYawOffset)
            ? this.aftermathYawOffset
            : sSign * VENTILATION_DUCT_CONSTANTS.fallenRy,
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
        pieceId: tpl.pieceId || null,
        ownerId: this.id,
        propId: this.id,
        propType: this.type,
        row: Number.isInteger(tpl.row) ? tpl.row : this.row,
        col: Number.isInteger(tpl.col) ? tpl.col : this.col,
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
        allowCorridorBlock: Boolean(tpl.allowCorridorBlock),
        traversable: Boolean(tpl.traversable),
        stepHeight:
          Number.isFinite(tpl.stepHeight) && tpl.stepHeight > 0 ? tpl.stepHeight : 0,
      })
    }

    this._colliderEntries = nextEntries
    this._colliderVersion += 1
  }

  _shouldColliderBeEnabled(entry, activeProgress = 0) {
    if (this.isDisposed) return false
    if (entry.phase === 'rubble_piece') {
      if (this.isAftermathCleared) return false
      const piece = entry.pieceId ? this._rubblePieceById.get(entry.pieceId) : null
      if (!piece) return false
      if (piece.state === 'carried' || piece.state === 'placing') {
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
    if (entry.phase === 'always') {
      return !this.isAftermathCleared
    }
    if (entry.phase === 'cleared') {
      return this.isAftermathCleared === true
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
    const canClearState =
      this.state === HAZARD_STATES.DISABLED ||
      this.isPermanentlyCollapsed ||
      this.isDisabled
    if (!canClearState) {
      return false
    }
    if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      this.setFurnitureDisplacement(
        this.furnitureDispLocalX,
        ROTTEN_FURNITURE_HANDLING_LIMITS.minDispZ
      )
      return true
    }
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
    if (this.type === HAZARD_TYPES.STEAM_PIPE_BURST && this.originWorldPos) {
      return this.originWorldPos
    }
    if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING && this.originWorldPos) {
      return this.originWorldPos
    }
    if (this.type === HAZARD_TYPES.FALLING_WATER_TANK && this.fallenTankWorldPos) {
      return this.fallenTankWorldPos
    }
    if (
      this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY &&
      this.fallenMachineryWorldPos
    ) {
      return this.fallenMachineryWorldPos
    }
    if (
      this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE &&
      this.fallenDuctWorldPos
    ) {
      return this.fallenDuctWorldPos
    }
    if (this.dangerWorldPos) return this.dangerWorldPos
    if (this.worldPos) return this.worldPos
    return this.cellWorldPos
  }

  _hasInteractionLineOfSight(playerWorldPos, targetX, targetZ, propColliders = null) {
    if (
      this.maze &&
      !hasLineOfSightInMaze(
        playerWorldPos.x,
        playerWorldPos.z,
        targetX,
        targetZ,
        this.maze
      )
    ) {
      return false
    }
    if (
      propColliders &&
      !hasUnobstructedPropLineOfSight(
        playerWorldPos.x,
        playerWorldPos.z,
        targetX,
        targetZ,
        propColliders,
        { ignoreOwnerId: this.id }
      )
    ) {
      return false
    }
    return true
  }

  _resolveInteractionTarget(playerWorldPos, range, propColliders = null, out = null) {
    const target = out || this._interactTargetOut
    if (!target || !playerWorldPos) return null

    // Transverse fallen pipe spans wall-to-wall across the corridor: measure distance
    // to the closest interior point along the fallen pipe axis so left/center/right
    // lane approaches from either side work symmetrically without hitting side walls.
    if (this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES && this.dangerWorldPos) {
      const dx = playerWorldPos.x - this.dangerWorldPos.x
      const dz = playerWorldPos.z - this.dangerWorldPos.z
      const yaw = Number.isFinite(this.pipeYaw) ? this.pipeYaw : 0
      const cosY = Math.cos(yaw)
      const sinY = Math.sin(yaw)
      const localX = dx * cosY - dz * sinY
      const clampedHalfSpan = Math.min(
        1.45,
        Math.max(0.25, (this.aftermathHalfW ?? FALLING_PIPES_CONSTANTS.aftermathHalfW) - 0.45)
      )
      const clampedX = Math.max(-clampedHalfSpan, Math.min(clampedHalfSpan, localX))
      const segX = this.dangerWorldPos.x + clampedX * cosY
      const segZ = this.dangerWorldPos.z - clampedX * sinY
      const segDist = Math.hypot(playerWorldPos.x - segX, playerWorldPos.z - segZ)
      if (
        segDist <= range &&
        this._hasInteractionLineOfSight(playerWorldPos, segX, segZ, propColliders)
      ) {
        target.x = segX
        target.y = this.dangerWorldPos.y || 0
        target.z = segZ
        target.dist = segDist
        return target
      }
      // Fall back to center anchor if segment point failed LOS
      const centerDist = Math.hypot(dx, dz)
      if (
        centerDist <= range &&
        this._hasInteractionLineOfSight(
          playerWorldPos,
          this.dangerWorldPos.x,
          this.dangerWorldPos.z,
          propColliders
        )
      ) {
        target.x = this.dangerWorldPos.x
        target.y = this.dangerWorldPos.y || 0
        target.z = this.dangerWorldPos.z
        target.dist = centerDist
        return target
      }
      return null
    }

    // Full-width, longitudinally extended Ceiling Collapse rubble: prefer center distance when
    // already inside interaction range (preserving multi-hazard nearest selection), and fall back
    // to the closest interior point on the rubble OBB so players standing at either collapsed end
    // or either corridor lane can always clear the rubble.
    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE && this.dangerWorldPos) {
      const dx = playerWorldPos.x - this.dangerWorldPos.x
      const dz = playerWorldPos.z - this.dangerWorldPos.z
      const centerDist = Math.hypot(dx, dz)
      if (
        centerDist <= range &&
        this._hasInteractionLineOfSight(
          playerWorldPos,
          this.dangerWorldPos.x,
          this.dangerWorldPos.z,
          propColliders
        )
      ) {
        target.x = this.dangerWorldPos.x
        target.y = this.dangerWorldPos.y || 0
        target.z = this.dangerWorldPos.z
        target.dist = centerDist
        return target
      }
      const yaw = Number.isFinite(this.collapseYaw) ? this.collapseYaw : 0
      const cosY = Math.cos(yaw)
      const sinY = Math.sin(yaw)
      const localX = dx * cosY - dz * sinY
      const localZ = dx * sinY + dz * cosY
      const maxX = Math.max(
        0.2,
        (this.rubbleHalfW ?? CEILING_COLLAPSE_CONSTANTS.rubbleHalfW) - 0.35
      )
      const minZ = (this.rubbleMinLocalZ ?? -CEILING_COLLAPSE_CONSTANTS.rubbleHalfD) + 0.25
      const maxZ = (this.rubbleMaxLocalZ ?? CEILING_COLLAPSE_CONSTANTS.rubbleHalfD) - 0.25
      const clampedX = Math.max(-maxX, Math.min(maxX, localX))
      const clampedZ = minZ <= maxZ ? Math.max(minZ, Math.min(maxZ, localZ)) : 0
      const ptX = this.dangerWorldPos.x + clampedX * cosY + clampedZ * sinY
      const ptZ = this.dangerWorldPos.z - clampedX * sinY + clampedZ * cosY
      const edgeDist = Math.hypot(playerWorldPos.x - ptX, playerWorldPos.z - ptZ)
      if (
        edgeDist <= range &&
        this._hasInteractionLineOfSight(playerWorldPos, ptX, ptZ, propColliders)
      ) {
        target.x = ptX
        target.y = this.dangerWorldPos.y || 0
        target.z = ptZ
        target.dist = edgeDist
        return target
      }
      return null
    }

    // Full-width, longitudinally extended Rotten Furniture aftermath: prefer center distance when
    // already in range (preserving multi-hazard nearest selection), and fall back to the closest
    // interior point on the fallen shelving OBB so players approaching from either corridor end
    // or either lane can always press F to clear the fallen furniture.
    if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE && this.dangerWorldPos) {
      const dxC = playerWorldPos.x - this.dangerWorldPos.x
      const dzC = playerWorldPos.z - this.dangerWorldPos.z
      const centerDist = Math.hypot(dxC, dzC)
      if (
        centerDist <= range &&
        this._hasInteractionLineOfSight(
          playerWorldPos,
          this.dangerWorldPos.x,
          this.dangerWorldPos.z,
          propColliders
        )
      ) {
        target.x = this.dangerWorldPos.x
        target.y = this.dangerWorldPos.y || 0
        target.z = this.dangerWorldPos.z
        target.dist = centerDist
        return target
      }
      const base = this.cellWorldPos || this.dangerWorldPos
      const yaw = Number.isFinite(this.wallYaw) ? this.wallYaw : 0
      const cosY = Math.cos(yaw)
      const sinY = Math.sin(yaw)
      const dx = playerWorldPos.x - base.x
      const dz = playerWorldPos.z - base.z
      const localX = dx * cosY - dz * sinY
      const localZ = dx * sinY + dz * cosY
      const minX = (this.minLocalX ?? -ROTTEN_FURNITURE_CONSTANTS.halfSpanOpen) + 0.25
      const maxX = (this.maxLocalX ?? ROTTEN_FURNITURE_CONSTANTS.halfSpanOpen) - 0.25
      const fz = this.fallenLocalZ ?? ROTTEN_FURNITURE_CONSTANTS.fallenLocalZ
      const fhd = this.aftermathHalfD ?? ROTTEN_FURNITURE_CONSTANTS.aftermathHalfD
      const minZ = fz - fhd + 0.25
      const maxZ = fz + fhd - 0.25
      const clampedX = minX <= maxX ? Math.max(minX, Math.min(maxX, localX)) : this.lateralOffset || 0
      const clampedZ = minZ <= maxZ ? Math.max(minZ, Math.min(maxZ, localZ)) : fz
      const ptX = base.x + clampedX * cosY + clampedZ * sinY
      const ptZ = base.z - clampedX * sinY + clampedZ * cosY
      const edgeDist = Math.hypot(playerWorldPos.x - ptX, playerWorldPos.z - ptZ)
      if (
        edgeDist <= range &&
        this._hasInteractionLineOfSight(playerWorldPos, ptX, ptZ, propColliders)
      ) {
        target.x = ptX
        target.y = this.dangerWorldPos.y || 0
        target.z = ptZ
        target.dist = edgeDist
        return target
      }
      return null
    }

    const primary = this.getInteractionAnchor()
    const secondary =
      this.type === HAZARD_TYPES.STEAM_PIPE_BURST
        ? this.valveWorldPos
        : this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING
          ? this.breakerWorldPos
          : null

    let bestDist = Infinity
    let found = false

    if (primary) {
      const dist = Math.hypot(playerWorldPos.x - primary.x, playerWorldPos.z - primary.z)
      if (
        dist <= range &&
        this._hasInteractionLineOfSight(playerWorldPos, primary.x, primary.z, propColliders)
      ) {
        target.x = primary.x
        target.y = primary.y || 0
        target.z = primary.z
        target.dist = dist
        bestDist = dist
        found = true
      }
    }

    if (secondary) {
      const dist = Math.hypot(playerWorldPos.x - secondary.x, playerWorldPos.z - secondary.z)
      if (
        dist <= range &&
        dist < bestDist &&
        this._hasInteractionLineOfSight(playerWorldPos, secondary.x, secondary.z, propColliders)
      ) {
        target.x = secondary.x
        target.y = secondary.y || 0
        target.z = secondary.z
        target.dist = dist
        found = true
      }
    }

    return found ? target : null
  }

  canPlayerInteract(playerWorldPos, playerGridCell = null, options = null) {
    if (this.isDisposed || !this._interactionHandler || !playerWorldPos) {
      return false
    }
    const handler = this._interactionHandler
    if (typeof handler.canInteract === 'function') {
      if (!handler.canInteract(this, { playerWorldPos, playerGridCell })) {
        return false
      }
    }

    const range = Number.isFinite(handler.range)
      ? Math.max(0.1, handler.range)
      : DEFAULT_HAZARD_INTERACT_RANGE
    const propColliders = options?.propColliders || null
    return Boolean(
      this._resolveInteractionTarget(
        playerWorldPos,
        range,
        propColliders,
        this._interactTargetOut
      )
    )
  }

  getInteractableDescriptor(playerWorldPos, playerGridCell = null, options = null) {
    if (!this.canPlayerInteract(playerWorldPos, playerGridCell, options)) {
      return null
    }
    const handler = this._interactionHandler
    const target = this._interactTargetOut
    const prompt =
      typeof handler.getPrompt === 'function' ? handler.getPrompt(this) : handler

    const out = this._interactableOut
    out.kind = 'hazard'
    out.id = this.id
    out.type = this.type
    out.action = prompt?.action || 'hazard_interact'
    out.label = prompt?.label || 'Interact'
    out.shortLabel = prompt?.shortLabel || 'Use'
    out.distance = target ? target.dist : 0
    out.worldPos.x = target ? target.x : 0
    out.worldPos.y = target ? target.y : 0
    out.worldPos.z = target ? target.z : 0
    return out
  }

  interact(context = null) {
    if (this.isDisposed || !this._interactionHandler) {
      return { handled: false, action: null, hazard: this, clearAftermath: false, emitSoundRange: 0 }
    }
    const handler = this._interactionHandler
    if (context?.playerWorldPos) {
      const interactOptions = context?.propColliders
        ? { propColliders: context.propColliders }
        : null
      if (
        !this.canPlayerInteract(
          context.playerWorldPos,
          context.playerGridCell || null,
          interactOptions
        )
      ) {
        return { handled: false, action: null, hazard: this, clearAftermath: false, emitSoundRange: 0 }
      }
    } else if (typeof handler.canInteract === 'function') {
      if (!handler.canInteract(this, context || {})) {
        return { handled: false, action: null, hazard: this, clearAftermath: false, emitSoundRange: 0 }
      }
    }

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
      this._syncColliderStates(1)
      if (this.mesh?.userData) {
        this.mesh.userData.isPermanentlyCollapsed = true
      }
      if (!raw?.clearAftermath) {
        updateHazardVisualState(this.mesh, this.state, 1)
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
        corridorAxis: this.corridorAxis,
        collapseYaw: this.collapseYaw,
        ceilingSoffitY: this.ceilingSoffitY,
        localPatchOffset: this.localPatchOffset ? { ...this.localPatchOffset } : null,
        rubbleHalfW: this.rubbleHalfW,
        rubbleHalfD: this.rubbleHalfD,
        rubbleMinLocalZ: this.rubbleMinLocalZ,
        rubbleMaxLocalZ: this.rubbleMaxLocalZ,
        rubbleCenterLocalZ: this.rubbleCenterLocalZ,
        dangerHalfW: this.dangerHalfW,
        dangerMinLocalZ: this.dangerMinLocalZ,
        dangerMaxLocalZ: this.dangerMaxLocalZ,
        triggerHalfW: this.triggerHalfW,
        triggerMinLocalZ: this.triggerMinLocalZ,
        triggerMaxLocalZ: this.triggerMaxLocalZ,
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
        corridorAxis: this.corridorAxis,
        lateralOffset: this.lateralOffset,
        minLocalX: this.minLocalX,
        maxLocalX: this.maxLocalX,
        tipDir: this.tipDir ? { ...this.tipDir } : null,
        uprightHalfW: this.uprightHalfW,
        uprightHalfD: this.uprightHalfD,
        aftermathHalfW: this.aftermathHalfW,
        aftermathHalfD: this.aftermathHalfD,
        fallenLocalZ: this.fallenLocalZ,
        clearedLocalZ: this.clearedLocalZ,
        clearedHalfD: this.clearedHalfD,
        triggerMinLocalX: this.triggerMinLocalX,
        triggerMaxLocalX: this.triggerMaxLocalX,
        triggerHalfD: this.triggerHalfD,
        dangerMinLocalX: this.dangerMinLocalX,
        dangerMaxLocalX: this.dangerMaxLocalX,
        dangerHalfD: this.dangerHalfD,
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
        oppositeWallSide: this.oppositeWallSide,
        oppositeWallRow: this.oppositeWallRow,
        oppositeWallCol: this.oppositeWallCol,
        pipeYaw: this.pipeYaw,
        corridorAxis: this.corridorAxis,
        rollDir: this.rollDir ? { ...this.rollDir } : null,
        pipeRestY: this.pipeRestY,
        ceilingAnchorY: this.ceilingAnchorY,
        aftermathHalfW: this.aftermathHalfW,
        aftermathHalfD: this.aftermathHalfD,
        dangerHalfW: this.dangerHalfW ?? FALLING_PIPES_CONSTANTS.dangerHalfW,
        dangerHalfD: this.dangerHalfD ?? FALLING_PIPES_CONSTANTS.dangerHalfD,
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
        dangerCenterLocalX: this.steamDangerCenterLocalX,
        dangerHalfW: this.steamDangerHalfW,
        dangerMinLocalZ: this.steamDangerMinLocalZ,
        dangerMaxLocalZ: this.steamDangerMaxLocalZ,
      }
    }
    if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        origin: this.originWorldPos ? { ...this.originWorldPos } : { ...this.dangerWorldPos },
        breaker: this.breakerWorldPos ? { ...this.breakerWorldPos } : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        wallYaw: this.wallYaw,
      }
    }
    if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        halfW: this.aftermathHalfW ?? FLOOR_GRATE_CONSTANTS.colliderHalfW,
        halfD: this.aftermathHalfD ?? FLOOR_GRATE_CONSTANTS.colliderHalfD,
        pitDepth: this.pitDepth ?? FLOOR_GRATE_CONSTANTS.pitDepth,
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
        wallYaw: this.wallYaw,
        isBoundaryWall: this.isBoundaryWall,
        collapseDir: this.collapseDir ? { ...this.collapseDir } : null,
        dangerHalfW: this.config.dangerHalfW ?? WALL_COLLAPSE_CONSTANTS.dangerHalfW,
        dangerMinLocalZ: this.config.dangerMinLocalZ ?? WALL_COLLAPSE_CONSTANTS.dangerMinLocalZ,
        dangerMaxLocalZ: this.config.dangerMaxLocalZ ?? WALL_COLLAPSE_CONSTANTS.dangerMaxLocalZ,
        aftermathHalfW: this.aftermathHalfW ?? WALL_COLLAPSE_CONSTANTS.aftermathHalfW,
        aftermathHalfD: this.aftermathHalfD ?? WALL_COLLAPSE_CONSTANTS.aftermathHalfD,
      }
    }
    if (this.type === HAZARD_TYPES.FALLING_WATER_TANK && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        fallenTank: this.fallenTankWorldPos ? { ...this.fallenTankWorldPos } : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        flowSide: this.flowSide,
        flowDir: this.flowDir ? { ...this.flowDir } : null,
        sideSign: this.sideSign,
        surgeLength: this.surgeLength,
        surgeHalfWidth: this.surgeHalfWidth,
        impactProgress: WATER_TANK_CONSTANTS.impactProgress,
        aftermathHalfW: this.aftermathHalfW,
        aftermathHalfD: this.aftermathHalfD,
        tankRestY: this.tankRestY,
        ceilingAnchorY: this.ceilingAnchorY,
      }
    }
    if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        origin: this.originWorldPos ? { ...this.originWorldPos } : { ...this.dangerWorldPos },
        fallenMachinery: this.fallenMachineryWorldPos
          ? { ...this.fallenMachineryWorldPos }
          : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        ceilingStructureType: this.ceilingStructureType,
        ceilingBeamY: this.ceilingBeamY,
        swingSide: this.swingSide,
        swingDir: this.swingDir ? { ...this.swingDir } : null,
        sideSign: this.sideSign,
        hasSideWall: this.hasSideWall,
        clearedLocalX: this.clearedLocalX,
        clearedLocalZ: this.clearedLocalZ,
        impactProgress: SUSPENDED_MACHINERY_CONSTANTS.impactProgress,
        aftermathHalfW: this.aftermathHalfW,
        aftermathHalfD: this.aftermathHalfD,
        aftermathYawOffset: this.aftermathYawOffset,
        machineryRestY: this.machineryRestY,
        ceilingAnchorY: this.ceilingAnchorY,
      }
    }
    if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE && this.dangerWorldPos) {
      return {
        center: { ...this.dangerWorldPos },
        origin: this.originWorldPos ? { ...this.originWorldPos } : { ...this.dangerWorldPos },
        fallenDuct: this.fallenDuctWorldPos
          ? { ...this.fallenDuctWorldPos }
          : { ...this.dangerWorldPos },
        radius: this.dangerRadius,
        halfWidth: this.config.ductHalfWidth ?? 0.88,
        minLocalZ: this.config.ductMinLocalZ ?? -0.58,
        maxLocalZ: this.config.ductMaxLocalZ ?? 1.68,
        triggerRadius: this.triggerRadius,
        mountType: this.mountType,
        ceilingStructureType: this.ceilingStructureType,
        ceilingBeamY: this.ceilingBeamY,
        hangerPivotY: this.hangerPivotY,
        wallSide: this.wallSide,
        wallRow: this.wallRow,
        wallCol: this.wallCol,
        dropSide: this.dropSide,
        dropDir: this.dropDir ? { ...this.dropDir } : null,
        sideSign: this.sideSign,
        hasSideWall: this.hasSideWall,
        clearedLocalX: this.clearedLocalX,
        clearedLocalZ: this.clearedLocalZ,
        impactProgress: VENTILATION_DUCT_CONSTANTS.impactProgress,
        aftermathHalfW: this.aftermathHalfW,
        aftermathHalfD: this.aftermathHalfD,
        aftermathYawOffset: this.aftermathYawOffset,
        ductRestY: this.ductRestY,
        fallenY: this.fallenY,
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

  _isPointInFallingPipeArea(worldX, worldZ, margin = 0) {
    if (!this.dangerWorldPos) return false
    const dx = worldX - this.dangerWorldPos.x
    const dz = worldZ - this.dangerWorldPos.z
    const cosY = Math.cos(this.pipeYaw || 0)
    const sinY = Math.sin(this.pipeYaw || 0)
    // Inverse Y-rotation into pipeMountGroup local space:
    // local X runs transversely across the corridor; local Z runs along corridor travel
    const localX = dx * cosY - dz * sinY
    const localZ = dx * sinY + dz * cosY
    const halfW = (this.dangerHalfW ?? this.config.dangerHalfW ?? FALLING_PIPES_CONSTANTS.dangerHalfW) + margin
    const halfD = (this.dangerHalfD ?? this.config.dangerHalfD ?? FALLING_PIPES_CONSTANTS.dangerHalfD) + margin
    return Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD
  }

  _isPointInCeilingCollapseDangerArea(worldX, worldZ, margin = 0) {
    if (!this.dangerWorldPos) return false
    const dx = worldX - this.dangerWorldPos.x
    const dz = worldZ - this.dangerWorldPos.z
    const cosY = Math.cos(this.collapseYaw || 0)
    const sinY = Math.sin(this.collapseYaw || 0)
    // Inverse Y-rotation into ceilingPatchGroup local space:
    // local X spans both corridor tiles; local Z runs along corridor walking direction
    const localX = dx * cosY - dz * sinY
    const localZ = dx * sinY + dz * cosY
    const halfW = (this.dangerHalfW ?? CEILING_COLLAPSE_CONSTANTS.dangerHalfW) + margin
    const minZ = (this.dangerMinLocalZ ?? -CEILING_COLLAPSE_CONSTANTS.dangerHalfD) - margin
    const maxZ = (this.dangerMaxLocalZ ?? CEILING_COLLAPSE_CONSTANTS.dangerHalfD) + margin
    return Math.abs(localX) <= halfW && localZ >= minZ && localZ <= maxZ
  }

  _isPointInCeilingCollapseTriggerArea(worldX, worldZ, margin = 0) {
    if (!this.dangerWorldPos) return false
    const dx = worldX - this.dangerWorldPos.x
    const dz = worldZ - this.dangerWorldPos.z
    const cosY = Math.cos(this.collapseYaw || 0)
    const sinY = Math.sin(this.collapseYaw || 0)
    const localX = dx * cosY - dz * sinY
    const localZ = dx * sinY + dz * cosY
    const halfW = (this.triggerHalfW ?? CEILING_COLLAPSE_CONSTANTS.triggerHalfW) + margin
    const minZ = (this.triggerMinLocalZ ?? -CEILING_COLLAPSE_CONSTANTS.triggerHalfD) - margin
    const maxZ = (this.triggerMaxLocalZ ?? CEILING_COLLAPSE_CONSTANTS.triggerHalfD) + margin
    return Math.abs(localX) <= halfW && localZ >= minZ && localZ <= maxZ
  }

  _isPointInRottenFurnitureDangerArea(worldX, worldZ, margin = 0) {
    const base = this.cellWorldPos || this.dangerWorldPos
    if (!base) return false
    const dx = worldX - base.x
    const dz = worldZ - base.z
    const yaw = Number.isFinite(this.wallYaw) ? this.wallYaw : 0
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    // Inverse Y-rotation into wallAnchorGroup local space:
    // local X runs along corridor walking direction; local Z spans both corridor lanes (-2..+2)
    const localX = dx * cosY - dz * sinY
    const localZ = dx * sinY + dz * cosY
    const minX = (this.dangerMinLocalX ?? -ROTTEN_FURNITURE_CONSTANTS.dangerHalfWOpen) - margin
    const maxX = (this.dangerMaxLocalX ?? ROTTEN_FURNITURE_CONSTANTS.dangerHalfWOpen) + margin
    const halfD = (this.dangerHalfD ?? ROTTEN_FURNITURE_CONSTANTS.dangerHalfD) + margin
    return localX >= minX && localX <= maxX && Math.abs(localZ) <= halfD
  }

  _isPointInRottenFurnitureTriggerArea(worldX, worldZ, margin = 0) {
    const base = this.cellWorldPos || this.dangerWorldPos
    if (!base) return false
    const dx = worldX - base.x
    const dz = worldZ - base.z
    const yaw = Number.isFinite(this.wallYaw) ? this.wallYaw : 0
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    const localX = dx * cosY - dz * sinY
    const localZ = dx * sinY + dz * cosY
    const minX = (this.triggerMinLocalX ?? -ROTTEN_FURNITURE_CONSTANTS.triggerHalfWOpen) - margin
    const maxX = (this.triggerMaxLocalX ?? ROTTEN_FURNITURE_CONSTANTS.triggerHalfWOpen) + margin
    const halfD = (this.triggerHalfD ?? ROTTEN_FURNITURE_CONSTANTS.triggerHalfD) + margin
    return localX >= minX && localX <= maxX && Math.abs(localZ) <= halfD
  }

  resetState() {
    this._applyInitialTimerPhase()
    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
      for (let i = 0; i < this._rubblePieces.length; i += 1) {
        const piece = this._rubblePieces[i]
        piece.state = 'fallen'
        piece.worldPos.x = piece.restWorldPos.x
        piece.worldPos.y = piece.restWorldPos.y
        piece.worldPos.z = piece.restWorldPos.z
        piece.worldYaw = piece.restWorldYaw
        piece.row = piece.restRow
        piece.col = piece.restCol
        if (piece.mesh?.userData) {
          piece.mesh.userData.manualState = 'fallen'
          if (piece.mesh.userData.baseMaterial) {
            piece.mesh.material = piece.mesh.userData.baseMaterial
          }
        }
      }
      for (let i = 0; i < this._smallRubbleFragments.length; i += 1) {
        const frag = this._smallRubbleFragments[i]
        frag.state = 'fallen'
        if (frag.mesh?.userData) {
          frag.mesh.userData.manualState = 'fallen'
        }
      }
      for (let i = 0; i < this._colliderEntries.length; i += 1) {
        const entry = this._colliderEntries[i]
        if (!entry.pieceId) continue
        const piece = this._rubblePieceById.get(entry.pieceId)
        if (!piece) continue
        entry.cx = piece.restWorldPos.x
        entry.cz = piece.restWorldPos.z
        entry.yaw = piece.restWorldYaw
        entry.row = piece.restRow
        entry.col = piece.restCol
      }
      this._colliderVersion += 1
    } else if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      this.setFurnitureHighlighted(false)
      this.furnitureDispLocalX = 0
      this.furnitureDispLocalZ = 0
      if (this.mesh?.userData) {
        this.mesh.userData.furnitureDispLocalX = 0
        this.mesh.userData.furnitureDispLocalZ = 0
      }
      this._rebuildColliderEntries()
    }
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
    this._visualSyncedState = this.state
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

    const playerWorldPos = playerContext?.playerWorldPos || null
    const playerCell = playerContext?.playerGridCell
    const isPlayerOnTile =
      playerCell && playerCell.row === this.row && playerCell.col === this.col

    let isPlayerInImpactArea
    let isPlayerInWaterSurge = false
    let distToDischarge = Infinity
    let distToOrigin = Infinity
    let tankLocalX = Infinity
    let tankLocalZ = Infinity
    let machLocalX = Infinity
    let machLocalZ = Infinity
    let distToFallenMachinery = Infinity
    let ductLocalX = Infinity
    let ductLocalZ = Infinity
    let distToFallenDuct = Infinity

    const isSyntheticWallHostCell =
      Boolean(this.maze?.grid) && this.maze.grid[this.row]?.[this.col] !== 0
    const needsLosCheck =
      Boolean(this.maze && playerWorldPos && !isPlayerOnTile && !isSyntheticWallHostCell)
    let _cachedDischargeLOS
    const getDischargeLOS = () => {
      if (_cachedDischargeLOS !== undefined) return _cachedDischargeLOS
      if (!needsLosCheck || !this.dangerWorldPos) {
        _cachedDischargeLOS = true
        return true
      }
      _cachedDischargeLOS = hasLineOfSightInMaze(
        this.dangerWorldPos.x,
        this.dangerWorldPos.z,
        playerWorldPos.x,
        playerWorldPos.z,
        this.maze
      )
      return _cachedDischargeLOS
    }
    let _cachedOriginLOS
    const getOriginLOS = () => {
      if (_cachedOriginLOS !== undefined) return _cachedOriginLOS
      if (!needsLosCheck || !this.originWorldPos) {
        _cachedOriginLOS = true
        return true
      }
      _cachedOriginLOS = hasLineOfSightInMaze(
        this.originWorldPos.x,
        this.originWorldPos.z,
        playerWorldPos.x,
        playerWorldPos.z,
        this.maze
      )
      return _cachedOriginLOS
    }

    if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
      // Full two-tile width & longitudinally extended oriented ceiling collapse danger zone
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea =
          this._isPointInCeilingCollapseDangerArea(playerWorldPos.x, playerWorldPos.z) &&
          getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      // Full two-tile width & longitudinally extended oriented furniture collapse danger zone
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea =
          this._isPointInRottenFurnitureDangerArea(playerWorldPos.x, playerWorldPos.z) &&
          getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
      // Transverse OBB danger zone matching the full corridor-spanning fallen pipe footprint
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea =
          this._isPointInFallingPipeArea(
            playerWorldPos.x,
            playerWorldPos.z
          ) && getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea =
          this._isPointInSteamPlumeArea(
            playerWorldPos.x,
            playerWorldPos.z,
            STEAM_PIPE_CONSTANTS.playerFootprintPad
          ) && getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea = distToDischarge <= this.dangerRadius && getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.WALL_COLLAPSE) {
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea =
          this._isPointInWallCollapseArea(
            playerWorldPos.x,
            playerWorldPos.z,
            0.04
          ) && getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        isPlayerInImpactArea =
          this._isPointInGrateArea(
            playerWorldPos.x,
            playerWorldPos.z,
            0.04
          ) && getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.FALLING_WATER_TANK) {
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        const fx = this.flowDir ? this.flowDir.x : 0
        const fz = this.flowDir ? this.flowDir.z : 1
        tankLocalZ = dx * fx + dz * fz
        tankLocalX = dx * fz - dz * fx
        isPlayerInImpactArea = distToDischarge <= this.dangerRadius && getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        if (this.originWorldPos) {
          const ox = playerWorldPos.x - this.originWorldPos.x
          const oz = playerWorldPos.z - this.originWorldPos.z
          distToOrigin = Math.hypot(ox, oz)
          const cosY = Math.cos(this.machineryYaw || 0)
          const sinY = Math.sin(this.machineryYaw || 0)
          machLocalX = ox * cosY - oz * sinY
          machLocalZ = ox * sinY + oz * cosY
        } else {
          distToOrigin = distToDischarge
        }
        if (this.fallenMachineryWorldPos) {
          distToFallenMachinery = Math.hypot(
            playerWorldPos.x - this.fallenMachineryWorldPos.x,
            playerWorldPos.z - this.fallenMachineryWorldPos.z
          )
        } else {
          distToFallenMachinery = distToDischarge
        }
        isPlayerInImpactArea = distToDischarge <= this.dangerRadius && getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
      if (playerWorldPos && this.dangerWorldPos) {
        const dx = playerWorldPos.x - this.dangerWorldPos.x
        const dz = playerWorldPos.z - this.dangerWorldPos.z
        distToDischarge = Math.hypot(dx, dz)
        const refX = this.originWorldPos ? this.originWorldPos.x : this.dangerWorldPos.x
        const refZ = this.originWorldPos ? this.originWorldPos.z : this.dangerWorldPos.z
        const ox = playerWorldPos.x - refX
        const oz = playerWorldPos.z - refZ
        distToOrigin = Math.hypot(ox, oz)
        const cosY = Math.cos(this.ductYaw || 0)
        const sinY = Math.sin(this.ductYaw || 0)
        ductLocalX = ox * cosY - oz * sinY
        ductLocalZ = ox * sinY + oz * cosY
        if (this.fallenDuctWorldPos) {
          distToFallenDuct = Math.hypot(
            playerWorldPos.x - this.fallenDuctWorldPos.x,
            playerWorldPos.z - this.fallenDuctWorldPos.z
          )
        } else {
          distToFallenDuct = distToDischarge
        }
        const halfW = this.config.ductHalfWidth ?? 0.88
        const minZ = this.config.ductMinLocalZ ?? -0.58
        const maxZ = this.config.ductMaxLocalZ ?? 1.68
        isPlayerInImpactArea =
          ductLocalZ >= minZ &&
          ductLocalZ <= maxZ &&
          Math.abs(ductLocalX) <= halfW &&
          getDischargeLOS()
      } else {
        isPlayerInImpactArea = Boolean(isPlayerOnTile)
      }
    } else {
      isPlayerInImpactArea = Boolean(isPlayerOnTile)
      if (!isPlayerInImpactArea && playerWorldPos && this.cellWorldPos) {
        const dx = playerWorldPos.x - this.cellWorldPos.x
        const dz = playerWorldPos.z - this.cellWorldPos.z
        if (Math.hypot(dx, dz) <= 0.85) {
          isPlayerInImpactArea = true
        }
      }
    }

    if (this.state === HAZARD_STATES.DORMANT) {
      this.hasDealtDamage = false
      if (this.type === HAZARD_TYPES.CEILING_COLLAPSE) {
        const isPlayerApproaching =
          playerWorldPos && this.dangerWorldPos
            ? this._isPointInCeilingCollapseTriggerArea(playerWorldPos.x, playerWorldPos.z) &&
              getDischargeLOS()
            : Boolean(isPlayerOnTile)
        if (isPlayerApproaching) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else if (this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
        const isPlayerApproaching =
          playerWorldPos && this.dangerWorldPos
            ? this._isPointInRottenFurnitureTriggerArea(playerWorldPos.x, playerWorldPos.z) &&
              getDischargeLOS()
            : Boolean(isPlayerOnTile)
        if (isPlayerApproaching) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else if (this.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
        const isPlayerApproaching =
          playerWorldPos && this.dangerWorldPos
            ? (distToDischarge <= this.triggerRadius ||
                this._isPointInSteamPlumeArea(playerWorldPos.x, playerWorldPos.z, 0.45)) &&
              getDischargeLOS()
            : Boolean(isPlayerOnTile)
        if (isPlayerApproaching) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else if (
        this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES ||
        this.type === HAZARD_TYPES.WALL_COLLAPSE ||
        this.type === HAZARD_TYPES.FALLING_WATER_TANK ||
        this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING
      ) {
        const isPlayerApproaching =
          playerWorldPos && this.dangerWorldPos
            ? distToDischarge <= this.triggerRadius && getDischargeLOS()
            : Boolean(isPlayerOnTile)
        if (isPlayerApproaching) {
          this.state = HAZARD_STATES.WARNING
          this.timer = 0
        }
      } else if (this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
        const isPlayerApproaching =
          playerWorldPos && this.dangerWorldPos
            ? this._isPointInGrateArea(
                playerWorldPos.x,
                playerWorldPos.z,
                0.14
              ) && getDischargeLOS()
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
          playerWorldPos && this.dangerWorldPos
            ? (distToDischarge <= this.triggerRadius && getDischargeLOS()) ||
              (distToOrigin <= this.triggerRadius && getOriginLOS())
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
      const isPersistentHazard =
        this.type === HAZARD_TYPES.STEAM_PIPE_BURST ||
        this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING

      if (
        this.type === HAZARD_TYPES.CEILING_COLLAPSE ||
        this.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE ||
        this.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES ||
        this.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE ||
        this.type === HAZARD_TYPES.WALL_COLLAPSE
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
        const impactEnd = this.config.impactWindowEndProgress ?? 0.72
        const surgeStart =
          this.config.surgeStartProgress ?? WATER_TANK_CONSTANTS.surgeStartProgress
        const surgeT =
          activeProgress <= surgeStart
            ? 0
            : Math.min(1, (activeProgress - surgeStart) / (1 - surgeStart))
        let inSurgeRect = false
        if (surgeT > 0.01 && playerWorldPos && this.dangerWorldPos) {
          const reachEase = 1 - Math.pow(1 - surgeT, 2.4)
          const currentFrontZ = 0.45 + reachEase * (this.surgeLength - 0.45)
          inSurgeRect =
            tankLocalZ >= -0.62 &&
            tankLocalZ <= currentFrontZ &&
            Math.abs(tankLocalX) <= this.surgeHalfWidth
        }
        if (activeProgress > impactEnd) {
          isPlayerInImpactArea = false
        }
        if (isPlayerInImpactArea || inSurgeRect) {
          const hasLOS =
            !this.maze ||
            !playerWorldPos ||
            !this.dangerWorldPos ||
            hasLineOfSightInMaze(
              this.dangerWorldPos.x,
              this.dangerWorldPos.z,
              playerWorldPos.x,
              playerWorldPos.z,
              this.maze
            )
          if (!hasLOS) {
            isPlayerInImpactArea = false
          } else if (inSurgeRect) {
            isPlayerInWaterSurge = true
            isPlayerInImpactArea = true
          }
        }
        if (
          (isPlayerInWaterSurge || (isPlayerInImpactArea && surgeT > 0.01)) &&
          this._movementEffectOut
        ) {
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
        const impactEnd = this.config.impactWindowEndProgress ?? 0.72
        if (activeProgress > impactEnd) {
          isPlayerInImpactArea = false
        } else if (playerWorldPos && this.dangerWorldPos) {
          const sSign = (this.sideSign || 1) >= 0 ? 1 : -1
          const lateralSigned = machLocalX * sSign
          const inEnvelope =
            activeProgress < 0.35
              ? // Falling swing arc from overhead hoist origin toward impact side/forward lane
                (distToOrigin <= 0.95 || distToDischarge <= 1.15) &&
                machLocalZ >= -0.78 &&
                machLocalZ <= 1.55 &&
                lateralSigned >= -0.82 &&
                lateralSigned <= 1.65
              : // Crash & side-biased settling envelope around impact landing & resting chassis
                ((distToDischarge <= 1.15 && lateralSigned >= -0.82) ||
                  distToFallenMachinery <= 0.95) &&
                machLocalZ >= -0.45 &&
                machLocalZ <= 1.62 &&
                lateralSigned >= -0.82 &&
                lateralSigned <= 1.68
          isPlayerInImpactArea =
            inEnvelope &&
            (!this.maze ||
              (hasLineOfSightInMaze(
                this.dangerWorldPos.x,
                this.dangerWorldPos.z,
                playerWorldPos.x,
                playerWorldPos.z,
                this.maze
              ) &&
                (!this.originWorldPos ||
                  hasLineOfSightInMaze(
                    this.originWorldPos.x,
                    this.originWorldPos.z,
                    playerWorldPos.x,
                    playerWorldPos.z,
                    this.maze
                  ))))
        }
      } else if (this.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
        const activeProgress =
          this.config.activeDuration > 0
            ? Math.min(1, this.timer / this.config.activeDuration)
            : 1
        const impactEnd = this.config.impactWindowEndProgress ?? 0.72
        if (activeProgress > impactEnd) {
          isPlayerInImpactArea = false
        } else if (playerWorldPos) {
          const sSign = (this.sideSign || 1) >= 0 ? 1 : -1
          const lateralSigned = ductLocalX * sSign
          let inZone = Boolean(isPlayerInImpactArea)
          if (!inZone) {
            if (activeProgress < 0.45) {
              inZone =
                ductLocalZ >= -0.95 &&
                ductLocalZ <= 1.15 &&
                Math.abs(ductLocalX) <= 0.75
            } else {
              inZone = distToFallenDuct <= 0.78 && lateralSigned >= -0.78
            }
          }
          isPlayerInImpactArea =
            inZone &&
            (!this.maze ||
              !this.dangerWorldPos ||
              (hasLineOfSightInMaze(
                this.dangerWorldPos.x,
                this.dangerWorldPos.z,
                playerWorldPos.x,
                playerWorldPos.z,
                this.maze
              ) &&
                (!this.originWorldPos ||
                  hasLineOfSightInMaze(
                    this.originWorldPos.x,
                    this.originWorldPos.z,
                    playerWorldPos.x,
                    playerWorldPos.z,
                    this.maze
                  ))))
        }
      }

      if (isPersistentHazard) {
        if (isPlayerInImpactArea) {
          this.hasDealtDamage = true
          hit = {
            hazardId: this.id,
            type: this.type,
            damage: this.config.damage,
            row: this.row,
            col: this.col,
          }
        }
      } else {
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
          this._visualSyncedState = HAZARD_STATES.DISABLED
          return hit
        }
      }
    }

    const phaseDuration =
      this.state === HAZARD_STATES.ACTIVE
        ? this.config.activeDuration
        : this.config.warningDuration
    const isPersistentActive =
      this.state === HAZARD_STATES.ACTIVE &&
      (this.type === HAZARD_TYPES.STEAM_PIPE_BURST ||
        this.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING)
    const waterDripPeriod = WATER_TANK_CONSTANTS.dormantDripPeriodSec || 2.2
    const progress =
      this.state === HAZARD_STATES.DORMANT &&
      this.type === HAZARD_TYPES.FALLING_WATER_TANK
        ? (this.timer % waterDripPeriod) / waterDripPeriod
        : isPersistentActive
          ? phaseDuration > 0
            ? this.timer / phaseDuration
            : 0
          : phaseDuration > 0
            ? Math.min(1, this.timer / phaseDuration)
            : 0
    if (this.state === HAZARD_STATES.ACTIVE) {
      this._syncColliderStates(Math.min(1, progress))
    }

    let skipDistantDormantVisual = false
    if (
      this.state === HAZARD_STATES.DORMANT &&
      this._visualSyncedState === HAZARD_STATES.DORMANT &&
      playerWorldPos
    ) {
      const refPos = this.dangerWorldPos || this.worldPos || this.cellWorldPos
      if (refPos) {
        const vdx = playerWorldPos.x - refPos.x
        const vdz = playerWorldPos.z - refPos.z
        if (vdx * vdx + vdz * vdz > 38 * 38) {
          skipDistantDormantVisual = true
        }
      }
    }

    if (!skipDistantDormantVisual) {
      updateHazardVisualState(this.mesh, this.state, progress)
      this._visualSyncedState = this.state
    }

    return hit
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this._syncColliderStates(0)
    this._colliderEntries = []
    this._customColliderSpecs = null
    this._interactionHandler = null
    if (this._furnitureHighlightMatMap) {
      this.setFurnitureHighlighted(false)
      for (const hiMat of this._furnitureHighlightMatMap.values()) {
        hiMat?.dispose?.()
      }
      this._furnitureHighlightMatMap.clear()
    }
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
    this.localJunctionOffset = null
    this.localBreakerOffset = null
    this.localPitOffset = null
    this.breakerWorldPos = null
    this.clearBias = null
    this.tipDir = null
    this.rollDir = null
    this.ruptureDir = null
    this.collapseDir = null
    this.flowDir = null
    this.swingDir = null
    this.dropDir = null
    this.originWorldPos = null
    this.fallenTankWorldPos = null
    this.fallenMachineryWorldPos = null
    this.fallenDuctWorldPos = null
    this.lastMovementEffect = null
    this._movementEffectOut = null
    this._interactTargetOut = null
    return true
  }
}
