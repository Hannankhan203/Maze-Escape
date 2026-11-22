import { gridToWorld } from '../world/worldCoords.js'
import {
  ELEVATOR_DECK_HALF_SPAN,
  ELEVATOR_DECK_TOP_Y,
  ELEVATOR_OUTER_BOUND,
  getElevatorFloorHeightAtWorld,
  resolveElevatorLayout,
} from './buildElevators.js'

export const EXTRACTION_SEQUENCE_STAGES = {
  IDLE: 'idle',
  APPROACH_TURN: 'approach_turn',
  WALK_TO_THRESHOLD: 'walk_to_threshold',
  CLIMB_THRESHOLD: 'climb_threshold',
  ENTER_CABIN: 'enter_cabin',
  TURN_AND_SETTLE: 'turn_and_settle',
  DOORS_CLOSING: 'doors_closing',
  DEPARTING: 'departing',
  COMPLETED: 'completed',
}

export const DEFAULT_EXTRACTION_SEQUENCE_CONFIG = {
  enabled: true,
  approachTurnDuration: 0.26,
  minWalkDuration: 0.52,
  maxWalkDuration: 1.48,
  walkSpeedScale: 2.35,
  turnAndSettleDuration: 0.44,
  doorsCloseDuration: 0.76,
  departDuration: 1.12,
  cabinTargetLocalZ: 0.24,
}

const THIGH_LENGTH = 0.425
const SHIN_LENGTH = 0.395
const BOOT_SOLE_HEIGHT = 0.1
const BOOT_TOE_EXTENT = 0.18
const BOOT_HEEL_EXTENT = 0.065
const HIP_OFFSET_X = 0.094
const DEFAULT_PELVIS_Y = THIGH_LENGTH + SHIN_LENGTH + BOOT_SOLE_HEIGHT

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

function smoothstep3(u) {
  const t = clamp(u, 0, 1)
  return t * t * (3 - 2 * t)
}

function quinticProgress(u) {
  const t = clamp(u, 0, 1)
  return t * t * t * (10 + t * (-15 + 6 * t))
}

function quinticDerivative(u) {
  const t = clamp(u, 0, 1)
  const oneMinusU = 1 - t
  return 30 * t * t * oneMinusU * oneMinusU
}

function wrapAngleDiff(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current))
}

function computeBootMinRelY(pelvisX, pelvisZ, hipX, kneeX, ankleX, hipSignX) {
  const alpha1 = pelvisX + hipX
  const alpha2 = alpha1 + kneeX
  const alpha3 = alpha2 + ankleX
  const ankleY =
    -THIGH_LENGTH * Math.cos(alpha1) - SHIN_LENGTH * Math.cos(alpha2)
  const sinA3 = Math.sin(alpha3)
  const cosA3 = Math.cos(alpha3)
  const toeY = ankleY - BOOT_SOLE_HEIGHT * cosA3 + BOOT_TOE_EXTENT * sinA3
  const heelY = ankleY - BOOT_SOLE_HEIGHT * cosA3 - BOOT_HEEL_EXTENT * sinA3
  const rollShiftY = hipSignX * HIP_OFFSET_X * Math.sin(pelvisZ)
  return (toeY < heelY ? toeY : heelY) + rollShiftY
}

function localToWorldXZ(exitWorld, yaw, lx, lz) {
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  return {
    x: exitWorld.x + lx * cosY + lz * sinY,
    z: exitWorld.z - lx * sinY + lz * cosY,
  }
}

function worldToLocalXZ(exitWorld, yaw, wx, wz) {
  const dx = wx - exitWorld.x
  const dz = wz - exitWorld.z
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  return {
    lx: dx * cosY - dz * sinY,
    lz: dx * sinY + dz * cosY,
  }
}

/**
 * Resolves a collision-free world-space entry trajectory from the player's current
 * world position through the open extraction elevator doorway, up the threshold ramp,
 * and into the centered cabin standing position `local (0, 0.06, +0.24)`.
 */
export function resolveElevatorExtractionTrajectory(
  maze,
  playerPos = null,
  options = {}
) {
  if (!maze?.exit) {
    return null
  }
  const exitWorld = gridToWorld(maze.exit.row, maze.exit.col, maze)
  if (!exitWorld) {
    return null
  }

  const layout = resolveElevatorLayout(maze, maze.exit)
  const doorOutwardYaw = layout.yaw
  const { localSides } = layout

  const cabinTargetLocalX = 0
  const cabinTargetLocalZ = Number.isFinite(options?.cabinTargetLocalZ)
    ? clamp(options.cabinTargetLocalZ, -0.35, 0.65)
    : DEFAULT_EXTRACTION_SEQUENCE_CONFIG.cabinTargetLocalZ
  const cabinCenterWorld = localToWorldXZ(
    exitWorld,
    doorOutwardYaw,
    cabinTargetLocalX,
    cabinTargetLocalZ
  )

  let startX = Number.isFinite(playerPos?.x) ? playerPos.x : exitWorld.x
  let startZ = Number.isFinite(playerPos?.z) ? playerPos.z : exitWorld.z - 2.15

  const startLocal = worldToLocalXZ(exitWorld, doorOutwardYaw, startX, startZ)
  const points = [{ x: startX, z: startZ }]

  // Determine whether the player is approaching from an open side/rear or needs doorway alignment
  const approachingFromSideLeft = localSides.left && startLocal.lx < -1.15 && Math.abs(startLocal.lz) < 1.25
  const approachingFromSideRight = localSides.right && startLocal.lx > 1.15 && Math.abs(startLocal.lz) < 1.25
  const approachingFromRear = localSides.rear && startLocal.lz > 1.15 && Math.abs(startLocal.lx) < 1.25
  const insideDeckAlready =
    Math.abs(startLocal.lx) <= ELEVATOR_DECK_HALF_SPAN - 0.12 &&
    Math.abs(startLocal.lz) <= ELEVATOR_DECK_HALF_SPAN - 0.12

  const distDirect = Math.hypot(
    cabinCenterWorld.x - startX,
    cabinCenterWorld.z - startZ
  )

  if (distDirect > 0.12) {
    // Route around corner columns (±1.66) and console (-1.42) when entering via front portal
    const needsPortalAlignment =
      !insideDeckAlready &&
      !approachingFromSideLeft &&
      !approachingFromSideRight &&
      !approachingFromRear &&
      (Math.abs(startLocal.lx) > 0.62 || startLocal.lz > -1.35)

    if (needsPortalAlignment) {
      // If somehow behind a closed wall or far off center, route safely to doorway throat first
      const alignLocalX = clamp(startLocal.lx, -0.45, 0.45)
      const alignLocalZ = startLocal.lz <= -1.85 ? -1.96 : -2.05
      const alignWorld = localToWorldXZ(
        exitWorld,
        doorOutwardYaw,
        alignLocalX,
        alignLocalZ
      )
      if (Math.hypot(alignWorld.x - startX, alignWorld.z - startZ) > 0.16) {
        points.push(alignWorld)
      }
    }
    points.push(cabinCenterWorld)
  }

  // Compute cumulative lengths and locate ramp/threshold crossing boundaries
  let totalWalkDistance = 0
  const cumulativeLengths = [0]
  for (let i = 1; i < points.length; i += 1) {
    const segLen = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].z - points[i - 1].z
    )
    totalWalkDistance += segLen
    cumulativeLengths.push(totalWalkDistance)
  }

  const samplePointAtDist = (dist) => {
    if (points.length <= 1 || totalWalkDistance <= 1e-6) {
      return { x: cabinCenterWorld.x, z: cabinCenterWorld.z, yaw: wrapAngleDiff(doorOutwardYaw + Math.PI, 0) }
    }
    const d = clamp(dist, 0, totalWalkDistance)
    for (let i = 1; i < points.length; i += 1) {
      const s0 = cumulativeLengths[i - 1]
      const s1 = cumulativeLengths[i]
      if (d <= s1 || i === points.length - 1) {
        const span = Math.max(1e-6, s1 - s0)
        const t = clamp((d - s0) / span, 0, 1)
        const p0 = points[i - 1]
        const p1 = points[i]
        return {
          x: p0.x + (p1.x - p0.x) * t,
          z: p0.z + (p1.z - p0.z) * t,
          yaw: Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z)),
        }
      }
    }
    return { x: cabinCenterWorld.x, z: cabinCenterWorld.z, yaw: wrapAngleDiff(doorOutwardYaw + Math.PI, 0) }
  }

  let rampStartDist = 0
  let deckTopDist = 0
  if (totalWalkDistance > 0.08) {
    const samples = 48
    let foundRampStart = false
    let foundDeckTop = false
    for (let i = 0; i <= samples; i += 1) {
      const s = (i / samples) * totalWalkDistance
      const pt = samplePointAtDist(s)
      const loc = worldToLocalXZ(exitWorld, doorOutwardYaw, pt.x, pt.z)
      const cheb = Math.max(Math.abs(loc.lx), Math.abs(loc.lz))
      if (!foundRampStart && cheb <= ELEVATOR_OUTER_BOUND + 0.02) {
        rampStartDist = s
        foundRampStart = true
      }
      if (!foundDeckTop && cheb <= ELEVATOR_DECK_HALF_SPAN - 0.08) {
        deckTopDist = s
        foundDeckTop = true
      }
    }
    if (!foundRampStart) rampStartDist = totalWalkDistance * 0.25
    if (!foundDeckTop || deckTopDist <= rampStartDist) {
      deckTopDist = Math.min(totalWalkDistance, rampStartDist + Math.min(0.45, totalWalkDistance * 0.35))
    }
  }

  const firstSegEnd = points.length > 1 ? points[1] : cabinCenterWorld
  const approachYaw =
    Math.hypot(firstSegEnd.x - startX, firstSegEnd.z - startZ) > 0.04
      ? Math.atan2(-(firstSegEnd.x - startX), -(firstSegEnd.z - startZ))
      : wrapAngleDiff(doorOutwardYaw + Math.PI, 0)

  const lastSegStart = points.length >= 2 ? points[points.length - 2] : points[0]
  const entryFinalYaw =
    Math.hypot(cabinCenterWorld.x - lastSegStart.x, cabinCenterWorld.z - lastSegStart.z) > 0.04
      ? Math.atan2(-(cabinCenterWorld.x - lastSegStart.x), -(cabinCenterWorld.z - lastSegStart.z))
      : approachYaw

  return {
    exitWorld,
    doorOutwardYaw,
    approachYaw,
    entryFinalYaw,
    points,
    cumulativeLengths,
    totalWalkDistance,
    rampStartDist,
    deckTopDist,
    startX,
    startZ,
    startY: getElevatorFloorHeightAtWorld(startX, startZ, maze),
    cabinCenterX: cabinCenterWorld.x,
    cabinCenterZ: cabinCenterWorld.z,
    cabinCenterY: ELEVATOR_DECK_TOP_Y,
    insideDeckAlready,
  }
}

/**
 * Zero-allocation Phase 3 controller for the complete Emergency Extraction Sequence:
 * approach & turn -> walk toward doorway -> climb threshold ramp -> center in cabin ->
 * turn to face doors -> doors slide shut & crossbar locks -> beacons & winch depart -> victory.
 */
export class ElevatorExtractionSequence {
  constructor(config = {}) {
    this.isDisposed = false
    this.config = {
      ...DEFAULT_EXTRACTION_SEQUENCE_CONFIG,
      ...(config || {}),
    }

    this._active = false
    this._stage = EXTRACTION_SEQUENCE_STAGES.IDLE
    this._elapsed = 0

    this._approachTurnDuration = 0
    this._walkTotalDuration = 0
    this._turnAndSettleDuration = 0
    this._doorsCloseDuration = 0
    this._departDuration = 0
    this._totalDuration = 0

    this._maze = null
    this._pointsX = [0, 0, 0]
    this._pointsZ = [0, 0, 0]
    this._cumLen = [0, 0, 0]
    this._pointCount = 0
    this._totalWalkDistance = 0
    this._rampStartDist = 0
    this._deckTopDist = 0

    this._startYaw = 0
    this._approachYaw = 0
    this._entryFinalYaw = 0
    this._doorOutwardYaw = 0
    this._cabinCenterX = 0
    this._cabinCenterZ = 0

    this._stepOutput = {
      active: false,
      completed: false,
      stage: EXTRACTION_SEQUENCE_STAGES.IDLE,
      progress: 0,
      stageProgress: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      deltaYaw: 0,
      actualSpeed: 0,
      moved: false,
      fpEyeOffsetY: 0,
      turnEnvelope: 0,
      climbEnvelope: 0,
      departBraceEnvelope: 0,
      turnSign: 1,
      doorCloseProgress: 0,
      departureProgress: 0,
    }
  }

  start(maze, playerPos = null, options = {}) {
    if (this.isDisposed || this.config.enabled === false || !maze?.exit) {
      this._active = false
      this._stage = EXTRACTION_SEQUENCE_STAGES.COMPLETED
      return false
    }

    const traj = resolveElevatorExtractionTrajectory(maze, playerPos, options)
    if (!traj) {
      this._active = false
      this._stage = EXTRACTION_SEQUENCE_STAGES.COMPLETED
      return false
    }

    this._maze = maze
    this._pointCount = Math.min(3, traj.points.length)
    for (let i = 0; i < this._pointCount; i += 1) {
      this._pointsX[i] = traj.points[i].x
      this._pointsZ[i] = traj.points[i].z
      this._cumLen[i] = traj.cumulativeLengths[i]
    }
    this._totalWalkDistance = traj.totalWalkDistance
    this._rampStartDist = traj.rampStartDist
    this._deckTopDist = traj.deckTopDist
    this._cabinCenterX = traj.cabinCenterX
    this._cabinCenterZ = traj.cabinCenterZ
    this._doorOutwardYaw = traj.doorOutwardYaw
    this._approachYaw = traj.approachYaw
    this._entryFinalYaw = traj.entryFinalYaw

    const currentYaw = Number.isFinite(options?.initialYaw)
      ? options.initialYaw
      : traj.approachYaw
    this._startYaw = currentYaw

    const initialTurnDiff = Math.abs(wrapAngleDiff(this._approachYaw, this._startYaw))
    const hasWalk = this._totalWalkDistance > 0.12

    this._approachTurnDuration =
      hasWalk && initialTurnDiff > 0.04
        ? clamp(
            (Number(this.config.approachTurnDuration) || 0.26) *
              clamp(initialTurnDiff / 1.1, 0.55, 1.35),
            0.14,
            0.38
          )
        : 0

    const walkSpeed = Math.max(1.2, Number(this.config.walkSpeedScale) || 2.35)
    this._walkTotalDuration = hasWalk
      ? clamp(
          this._totalWalkDistance / walkSpeed + 0.34,
          Number(this.config.minWalkDuration) || 0.52,
          Number(this.config.maxWalkDuration) || 1.48
        )
      : 0

    const settleTurnDiff = Math.abs(
      wrapAngleDiff(
        this._doorOutwardYaw,
        hasWalk ? this._entryFinalYaw : this._startYaw
      )
    )
    this._turnAndSettleDuration =
      settleTurnDiff > 0.05
        ? Math.max(0.24, Number(this.config.turnAndSettleDuration) || 0.44)
        : 0.22

    this._doorsCloseDuration = Math.max(
      0.35,
      Number(this.config.doorsCloseDuration) || 0.76
    )
    this._departDuration = Math.max(
      0.4,
      Number(this.config.departDuration) || 1.12
    )
    this._totalDuration =
      this._approachTurnDuration +
      this._walkTotalDuration +
      this._turnAndSettleDuration +
      this._doorsCloseDuration +
      this._departDuration

    this._elapsed = 0
    this._active = true
    const firstStage =
      this._approachTurnDuration > 0
        ? EXTRACTION_SEQUENCE_STAGES.APPROACH_TURN
        : hasWalk
          ? EXTRACTION_SEQUENCE_STAGES.WALK_TO_THRESHOLD
          : EXTRACTION_SEQUENCE_STAGES.TURN_AND_SETTLE
    this._stage = firstStage

    const out = this._stepOutput
    out.active = true
    out.completed = false
    out.stage = firstStage
    out.progress = 0
    out.stageProgress = 0
    out.x = traj.startX
    out.y = traj.startY
    out.z = traj.startZ
    out.yaw = this._startYaw
    out.deltaYaw = 0
    out.actualSpeed = 0
    out.moved = false
    out.fpEyeOffsetY = 0
    out.turnEnvelope = 0
    out.climbEnvelope = 0
    out.departBraceEnvelope = 0
    out.turnSign =
      wrapAngleDiff(this._approachYaw, this._startYaw) >= 0 ? 1 : -1
    out.doorCloseProgress = 0
    out.departureProgress = 0

    return true
  }

  cancel() {
    const wasActive = this._active
    this._active = false
    this._stage = EXTRACTION_SEQUENCE_STAGES.IDLE
    this._elapsed = 0
    const out = this._stepOutput
    out.active = false
    out.completed = false
    out.stage = EXTRACTION_SEQUENCE_STAGES.IDLE
    out.progress = 0
    out.stageProgress = 0
    out.deltaYaw = 0
    out.actualSpeed = 0
    out.moved = false
    out.fpEyeOffsetY = 0
    out.turnEnvelope = 0
    out.climbEnvelope = 0
    out.departBraceEnvelope = 0
    out.doorCloseProgress = 0
    out.departureProgress = 0
    return wasActive
  }

  isActive() {
    return this._active && !this.isDisposed
  }

  getDuration() {
    return this._totalDuration
  }

  getState() {
    const o = this._stepOutput
    return {
      active: this._active,
      stage: this._stage,
      elapsed: this._elapsed,
      duration: this._totalDuration,
      progress: o.progress,
      stageProgress: o.stageProgress,
      x: o.x,
      y: o.y,
      z: o.z,
      yaw: o.yaw,
      doorOutwardYaw: this._doorOutwardYaw,
      actualSpeed: o.actualSpeed,
      moved: o.moved,
      doorCloseProgress: o.doorCloseProgress,
      departureProgress: o.departureProgress,
    }
  }

  _samplePath(dist, out) {
    if (this._pointCount <= 1 || this._totalWalkDistance <= 1e-6) {
      out.x = this._cabinCenterX
      out.z = this._cabinCenterZ
      out.yaw = this._entryFinalYaw
      return
    }
    const d = clamp(dist, 0, this._totalWalkDistance)
    for (let i = 1; i < this._pointCount; i += 1) {
      const s0 = this._cumLen[i - 1]
      const s1 = this._cumLen[i]
      if (d <= s1 || i === this._pointCount - 1) {
        const span = Math.max(1e-6, s1 - s0)
        const t = clamp((d - s0) / span, 0, 1)
        const p0x = this._pointsX[i - 1]
        const p0z = this._pointsZ[i - 1]
        const p1x = this._pointsX[i]
        const p1z = this._pointsZ[i]
        out.x = p0x + (p1x - p0x) * t
        out.z = p0z + (p1z - p0z) * t
        out.yaw = Math.atan2(-(p1x - p0x), -(p1z - p0z))
        return
      }
    }
  }

  /**
   * Advances the extraction sequence by `delta` seconds.
   * Zero allocations; writes directly to `this._stepOutput`.
   */
  update(delta = 0, options = {}) {
    const out = this._stepOutput
    if (this.isDisposed || !this._active) {
      out.active = false
      out.completed = false
      out.deltaYaw = 0
      return out
    }

    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0
    const prevYaw = out.yaw
    this._elapsed = Math.min(this._totalDuration, this._elapsed + dt)

    const turnEnd = this._approachTurnDuration
    const walkEnd = turnEnd + this._walkTotalDuration
    const settleEnd = walkEnd + this._turnAndSettleDuration
    const doorsEnd = settleEnd + this._doorsCloseDuration
    const total = this._totalDuration

    const reducedMotion = Boolean(options?.reducedMotion)
    const deckOffsetY = Number.isFinite(options?.deckOffsetY)
      ? options.deckOffsetY
      : 0

    let x = this._pointCount > 0 ? this._pointsX[0] : this._cabinCenterX
    let z = this._pointCount > 0 ? this._pointsZ[0] : this._cabinCenterZ
    let yaw = this._startYaw
    let speed = 0
    let moved = false
    let stageProgress = 0
    let turnEnvelope = 0
    let climbEnvelope = 0
    let departBraceEnvelope = 0
    let turnSign = 1
    let fpEyeOffsetY = 0
    let doorCloseProgress = 0
    let departureProgress = 0

    if (this._elapsed < turnEnd && this._approachTurnDuration > 0) {
      this._stage = EXTRACTION_SEQUENCE_STAGES.APPROACH_TURN
      stageProgress = clamp(this._elapsed / this._approachTurnDuration, 0, 1)
      const diff = wrapAngleDiff(this._approachYaw, this._startYaw)
      yaw = this._startYaw + diff * smoothstep3(stageProgress)
      turnEnvelope = Math.sin(Math.PI * stageProgress)
      turnSign = diff >= 0 ? 1 : -1
      fpEyeOffsetY = reducedMotion ? 0 : -0.01 * turnEnvelope
    } else if (this._elapsed < walkEnd && this._walkTotalDuration > 0) {
      const walkU = clamp(
        (this._elapsed - turnEnd) / this._walkTotalDuration,
        0,
        1
      )
      const dist = this._totalWalkDistance * quinticProgress(walkU)
      this._samplePath(dist, out)
      x = out.x
      z = out.z

      // Smoothly blend yaw across multi-segment doorway alignment corner
      const targetSegYaw = out.yaw
      const yawBlend =
        this._pointCount > 2
          ? smoothstep3(clamp(walkU * 3.2, 0, 1))
          : 1
      const baseYaw = this._approachTurnDuration > 0 ? this._approachYaw : this._startYaw
      const yawDiff = wrapAngleDiff(targetSegYaw, baseYaw)
      yaw = baseYaw + yawDiff * yawBlend

      speed =
        (this._totalWalkDistance / this._walkTotalDuration) *
        quinticDerivative(walkU)
      moved = speed > 0.05

      if (dist < this._rampStartDist && this._rampStartDist > 0.06) {
        this._stage = EXTRACTION_SEQUENCE_STAGES.WALK_TO_THRESHOLD
        stageProgress = clamp(dist / this._rampStartDist, 0, 1)
      } else if (dist <= this._deckTopDist + 0.04 && this._deckTopDist > this._rampStartDist) {
        this._stage = EXTRACTION_SEQUENCE_STAGES.CLIMB_THRESHOLD
        stageProgress = clamp(
          (dist - this._rampStartDist) /
            Math.max(0.08, this._deckTopDist - this._rampStartDist),
          0,
          1
        )
        climbEnvelope = Math.sin(Math.PI * stageProgress)
      } else {
        this._stage = EXTRACTION_SEQUENCE_STAGES.ENTER_CABIN
        stageProgress = clamp(
          (dist - this._deckTopDist) /
            Math.max(0.08, this._totalWalkDistance - this._deckTopDist),
          0,
          1
        )
      }

      if (!reducedMotion) {
        const bobEnv = Math.sin(Math.PI * walkU)
        fpEyeOffsetY =
          -0.015 * Math.abs(Math.sin(walkU * Math.PI * 3.2)) * bobEnv +
          0.014 * climbEnvelope
      }
    } else if (this._elapsed < settleEnd) {
      this._stage = EXTRACTION_SEQUENCE_STAGES.TURN_AND_SETTLE
      stageProgress = clamp(
        (this._elapsed - walkEnd) / Math.max(0.01, this._turnAndSettleDuration),
        0,
        1
      )
      x = this._cabinCenterX
      z = this._cabinCenterZ
      const settleFromYaw =
        this._walkTotalDuration > 0 ? this._entryFinalYaw : this._startYaw
      const diff = wrapAngleDiff(this._doorOutwardYaw, settleFromYaw)
      yaw = settleFromYaw + diff * smoothstep3(stageProgress)
      turnEnvelope =
        Math.abs(diff) > 0.05 ? Math.sin(Math.PI * stageProgress) : 0
      turnSign = diff >= 0 ? 1 : -1
      fpEyeOffsetY = reducedMotion ? 0 : -0.012 * Math.sin(Math.PI * stageProgress)
    } else if (this._elapsed < doorsEnd) {
      this._stage = EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING
      stageProgress = clamp(
        (this._elapsed - settleEnd) / Math.max(0.01, this._doorsCloseDuration),
        0,
        1
      )
      x = this._cabinCenterX
      z = this._cabinCenterZ
      yaw = this._doorOutwardYaw
      doorCloseProgress = stageProgress
      fpEyeOffsetY = reducedMotion
        ? 0
        : -0.006 * Math.sin(Math.PI * stageProgress)
    } else if (this._elapsed < total) {
      this._stage = EXTRACTION_SEQUENCE_STAGES.DEPARTING
      stageProgress = clamp(
        (this._elapsed - doorsEnd) / Math.max(0.01, this._departDuration),
        0,
        1
      )
      x = this._cabinCenterX
      z = this._cabinCenterZ
      yaw = this._doorOutwardYaw
      doorCloseProgress = 1
      departureProgress = stageProgress
      departBraceEnvelope = reducedMotion
        ? 0
        : Math.sin(Math.PI * Math.min(1, stageProgress * 1.4))
      fpEyeOffsetY = reducedMotion
        ? 0
        : -0.016 * departBraceEnvelope
    } else {
      this._stage = EXTRACTION_SEQUENCE_STAGES.COMPLETED
      this._active = false
      stageProgress = 1
      x = this._cabinCenterX
      z = this._cabinCenterZ
      yaw = this._doorOutwardYaw
      doorCloseProgress = 1
      departureProgress = 1
    }

    const baseFloorY = getElevatorFloorHeightAtWorld(x, z, this._maze)
    const y = baseFloorY + (
      this._stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING ||
      this._stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED
        ? deckOffsetY
        : 0
    )

    out.active = this._active
    out.completed =
      !this._active && this._stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED
    out.stage = this._stage
    out.progress = total > 0 ? clamp(this._elapsed / total, 0, 1) : 1
    out.stageProgress = stageProgress
    out.x = x
    out.y = y
    out.z = z
    out.yaw = yaw
    out.deltaYaw = wrapAngleDiff(yaw, prevYaw)
    out.actualSpeed = speed
    out.moved = moved
    out.fpEyeOffsetY = fpEyeOffsetY
    out.turnEnvelope = turnEnvelope
    out.climbEnvelope = climbEnvelope
    out.departBraceEnvelope = departBraceEnvelope
    out.turnSign = turnSign
    out.doorCloseProgress = doorCloseProgress
    out.departureProgress = departureProgress

    return out
  }

  /**
   * Applies zero-allocation additive climbing knee/hip lift, torso forward lean,
   * turn weight-shift, and grounded departure absorption on the 16-pivot rig,
   * preserving flush boot contact at every frame.
   */
  applyPoseAdjustments(playerGroup) {
    const rig = playerGroup?.userData?.isDisposed
      ? null
      : playerGroup?.userData?.rig
    if (!rig) return

    const o = this._stepOutput
    const turn = o.turnEnvelope
    const climb = o.climbEnvelope
    const brace = o.departBraceEnvelope

    if (turn <= 1e-5 && climb <= 1e-5 && brace <= 1e-5) {
      return
    }

    const pelvis = rig.pelvisPivot
    const spine = rig.spinePivot || rig.upperBodyPivot
    const neck = rig.neckPivot
    const head = rig.headPivot
    const leftShoulder = rig.leftShoulderPivot || rig.leftArmPivot
    const rightShoulder = rig.rightShoulderPivot || rig.rightArmPivot
    const leftElbow = rig.leftElbowPivot
    const rightElbow = rig.rightElbowPivot
    const leftWrist = rig.leftWristPivot
    const rightWrist = rig.rightWristPivot
    const leftHip = rig.leftHipPivot || rig.leftLegPivot
    const rightHip = rig.rightHipPivot || rig.rightLegPivot
    const leftKnee = rig.leftKneePivot
    const rightKnee = rig.rightKneePivot
    const leftAnkle = rig.leftAnklePivot
    const rightAnkle = rig.rightAnklePivot

    const turnSign = o.turnSign

    // Determine which leg is currently swinging forward so climb lift targets the swing foot
    const leftHipCur = leftHip ? leftHip.rotation.x : 0
    const rightHipCur = rightHip ? rightHip.rotation.x : 0
    const leftSwingW = clamp(0.5 + (leftHipCur - rightHipCur) * 1.4, 0, 1)
    const rightSwingW = 1 - leftSwingW

    if (pelvis) {
      if (pelvis.position && turn > 1e-5) {
        pelvis.position.x += 0.022 * turn * turnSign
      }
      if (turn > 1e-5) {
        pelvis.rotation.y += -0.09 * turn * turnSign
        pelvis.rotation.z += 0.042 * turn * turnSign
      }
      if (climb > 1e-5) {
        pelvis.rotation.x -= 0.032 * climb
      }
      if (brace > 1e-5) {
        pelvis.rotation.x -= 0.024 * brace
      }
    }

    const leftClimbHip = 0.26 * climb * leftSwingW + 0.05 * climb * rightSwingW
    const rightClimbHip = 0.26 * climb * rightSwingW + 0.05 * climb * leftSwingW
    const leftClimbKnee = -0.44 * climb * leftSwingW - 0.09 * climb * rightSwingW
    const rightClimbKnee = -0.44 * climb * rightSwingW - 0.09 * climb * leftSwingW
    const leftClimbAnkle = 0.14 * climb * leftSwingW - 0.04 * climb * rightSwingW
    const rightClimbAnkle = 0.14 * climb * rightSwingW - 0.04 * climb * leftSwingW

    const turnStep = turn > 1e-5 ? turn : 0
    const leftTurnHip = turnStep * (turnSign > 0 ? 0.15 : -0.06)
    const rightTurnHip = turnStep * (turnSign > 0 ? -0.06 : 0.15)
    const leftTurnKnee = turnStep * (turnSign > 0 ? -0.2 : -0.05)
    const rightTurnKnee = turnStep * (turnSign > 0 ? -0.05 : -0.2)

    const braceHip = 0.085 * brace
    const braceKnee = -0.145 * brace
    const braceAnkle = 0.06 * brace

    if (leftHip) {
      leftHip.rotation.x += leftClimbHip + leftTurnHip + braceHip
    }
    if (leftKnee) {
      leftKnee.rotation.x = clamp(
        leftKnee.rotation.x + leftClimbKnee + leftTurnKnee + braceKnee,
        -1.75,
        0
      )
    }
    if (leftAnkle) {
      leftAnkle.rotation.x = clamp(
        leftAnkle.rotation.x + leftClimbAnkle + 0.04 * turnStep + braceAnkle,
        -0.64,
        0.52
      )
    }

    if (rightHip) {
      rightHip.rotation.x += rightClimbHip + rightTurnHip + braceHip
    }
    if (rightKnee) {
      rightKnee.rotation.x = clamp(
        rightKnee.rotation.x + rightClimbKnee + rightTurnKnee + braceKnee,
        -1.75,
        0
      )
    }
    if (rightAnkle) {
      rightAnkle.rotation.x = clamp(
        rightAnkle.rotation.x + rightClimbAnkle + 0.04 * turnStep + braceAnkle,
        -0.64,
        0.52
      )
    }

    // Torso lean forward (-X) during step-up climb + counter-rotation during turns + departure brace
    if (spine) {
      spine.rotation.x -= 0.085 * climb + 0.055 * brace
      if (turn > 1e-5) {
        spine.rotation.y += 0.1 * turn * turnSign
        spine.rotation.z += -0.03 * turn * turnSign
      }
    }

    if (leftShoulder) {
      leftShoulder.rotation.x +=
        0.06 * climb * rightSwingW - 0.11 * turnStep * turnSign + 0.07 * brace
      leftShoulder.rotation.z += -0.045 * climb - 0.03 * turnStep - 0.04 * brace
    }
    if (leftElbow) {
      leftElbow.rotation.x = clamp(
        leftElbow.rotation.x + 0.22 * climb + 0.12 * turnStep + 0.16 * brace,
        0.08,
        1.75
      )
    }
    if (leftWrist) {
      leftWrist.rotation.x += 0.04 * climb + 0.03 * brace
    }

    if (rightShoulder) {
      rightShoulder.rotation.x +=
        0.06 * climb * leftSwingW + 0.11 * turnStep * turnSign + 0.06 * brace
      rightShoulder.rotation.z += 0.045 * climb + 0.03 * turnStep + 0.04 * brace
    }
    if (rightElbow) {
      rightElbow.rotation.x = clamp(
        rightElbow.rotation.x + 0.22 * climb + 0.12 * turnStep + 0.16 * brace,
        0.08,
        1.75
      )
    }
    if (rightWrist) {
      rightWrist.rotation.x += 0.04 * climb + 0.03 * brace
    }

    if (neck) {
      neck.rotation.x += 0.04 * climb + 0.03 * brace
      neck.rotation.y += -0.1 * turn * turnSign
    }
    if (head) {
      head.rotation.x += 0.045 * climb + 0.03 * brace
      head.rotation.y += -0.15 * turn * turnSign
    }

    // Recompute exact grounded pelvis height so lowest boot stays flush with floor/deck
    if (
      pelvis &&
      pelvis.position &&
      leftHip &&
      leftKnee &&
      leftAnkle &&
      rightHip &&
      rightKnee &&
      rightAnkle
    ) {
      const restPelvisY = Number.isFinite(rig.restPose?.pelvisY)
        ? rig.restPose.pelvisY
        : DEFAULT_PELVIS_Y
      const px = pelvis.rotation.x
      const pz = pelvis.rotation.z
      const leftMin = computeBootMinRelY(
        px,
        pz,
        leftHip.rotation.x,
        leftKnee.rotation.x,
        leftAnkle.rotation.x,
        -1
      )
      const rightMin = computeBootMinRelY(
        px,
        pz,
        rightHip.rotation.x,
        rightKnee.rotation.x,
        rightAnkle.rotation.x,
        1
      )
      const minRel = leftMin < rightMin ? leftMin : rightMin
      pelvis.position.y = restPelvisY - (DEFAULT_PELVIS_Y + minRel)
    }
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.cancel()
    this._maze = null
    return true
  }
}
