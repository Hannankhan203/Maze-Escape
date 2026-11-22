import { gridToWorld } from '../world/worldCoords.js'
import {
  ELEVATOR_DECK_TOP_Y,
  ELEVATOR_OUTER_BOUND,
  getElevatorFloorHeightAtWorld,
  resolveElevatorLayout,
} from './buildElevators.js'

export const SPAWN_SEQUENCE_STAGES = {
  IDLE: 'idle',
  ELEVATOR_DESCEND: 'elevator_descend',
  ELEVATOR_IMPACT: 'elevator_impact',
  ELEVATOR_SETTLE: 'elevator_settle',
  IDLE_RECOVER: 'idle_recover',
  TURN_TO_EXIT: 'turn_to_exit',
  WALK_OFF: 'walk_off',
  SETTLE: 'settle',
  COMPLETED: 'completed',
}

export const DEFAULT_SPAWN_SEQUENCE_CONFIG = {
  enabled: true,
  startElevationY: 8.4,
  descentDuration: 1.4,
  impactDuration: 0.3,
  settleDurationPreExit: 0.66,
  recoverDuration: 0.26,
  turnDuration: 0.34,
  walkDuration: 1.08,
  settleDuration: 0.22,
  exitDistance: ELEVATOR_OUTER_BOUND + 0.12, // 1.96m: completely off 1.84m ramp & heels (0.065m), inside 2.0m cell
  initialStaggerYawOffset: 0.38,
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
  return u * u * (3 - 2 * u)
}

function quinticProgress(u) {
  return u * u * u * (10 + u * (-15 + 6 * u))
}

function quinticDerivative(u) {
  const oneMinusU = 1 - u
  return 30 * u * u * oneMinusU * oneMinusU
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

/**
 * Resolves the world-space start deck anchor, open exit direction unit vector,
 * and final step-off target just beyond the beveled elevator threshold ramp.
 */
export function resolveElevatorExitTrajectory(maze, options = {}) {
  if (!maze?.start) {
    return null
  }
  const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)
  if (!startWorld) {
    return null
  }

  const layout = resolveElevatorLayout(maze, maze.start)
  const exitYaw = Number.isFinite(options?.exitYaw) ? options.exitYaw : layout.yaw
  const dirX = -Math.sin(exitYaw)
  const dirZ = -Math.cos(exitYaw)
  const requestedDistance = Number.isFinite(options?.exitDistance)
    ? options.exitDistance
    : DEFAULT_SPAWN_SEQUENCE_CONFIG.exitDistance
  const hasOpenExit = Boolean(
    layout.localSides.front ||
      layout.localSides.rear ||
      layout.localSides.left ||
      layout.localSides.right
  )
  const exitDistance = hasOpenExit ? clamp(requestedDistance, 1.88, 1.98) : 0
  const startY = getElevatorFloorHeightAtWorld(startWorld.x, startWorld.z, maze)
  const endX = startWorld.x + dirX * exitDistance
  const endZ = startWorld.z + dirZ * exitDistance
  const endY = getElevatorFloorHeightAtWorld(endX, endZ, maze)

  return {
    startX: startWorld.x,
    startY: startY > 0 ? startY : ELEVATOR_DECK_TOP_Y,
    startZ: startWorld.z,
    endX,
    endY,
    endZ,
    dirX,
    dirZ,
    exitYaw,
    hasOpenExit,
    exitDistance,
  }
}

/**
 * Zero-allocation controller for the Phase 2 broken-elevator step-off intro.
 * Coordinates timed recovery, turn-to-exit, ramp descent, grounded 16-pivot
 * secondary articulation, and seamless handoff to player control.
 */
export class ElevatorExitSequence {
  constructor(config = {}) {
    this.isDisposed = false
    this.config = {
      ...DEFAULT_SPAWN_SEQUENCE_CONFIG,
      ...(config || {}),
    }

    this._active = false
    this._stage = SPAWN_SEQUENCE_STAGES.IDLE
    this._elapsed = 0
    this._startElevationY = Math.max(0, Number(this.config.startElevationY) || 0)
    this._descentDuration = this._startElevationY > 0.05
      ? Math.max(0.15, Number(this.config.descentDuration) || 1.45)
      : 0
    this._impactDuration = this._descentDuration > 0
      ? Math.max(0.08, Number(this.config.impactDuration) || 0.22)
      : 0
    this._preExitSettleDuration = this._descentDuration > 0
      ? Math.max(0.08, Number(this.config.settleDurationPreExit) || 0.42)
      : 0
    this._recoverDuration = this.config.recoverDuration
    this._turnDuration = this.config.turnDuration
    this._walkDuration = this.config.walkDuration
    this._settleDuration = this.config.settleDuration
    this._totalDuration =
      this._descentDuration +
      this._impactDuration +
      this._preExitSettleDuration +
      this._recoverDuration +
      this._turnDuration +
      this._walkDuration +
      this._settleDuration

    this._maze = null
    this._startX = 0
    this._startY = ELEVATOR_DECK_TOP_Y
    this._startZ = 0
    this._endX = 0
    this._endY = 0
    this._endZ = 0
    this._dirX = 0
    this._dirZ = -1
    this._exitYaw = 0
    this._exitDistance = 0
    this._hasOpenExit = true
    this._initialYawOffset = this.config.initialStaggerYawOffset
    this._currentYawOffset = 0
    this._walkSpeedRef = 5.5
    this._elevatorY = 0
    this._vibrationY = 0
    this._impactFired = false

    this._stepOutput = {
      active: false,
      completed: false,
      stage: SPAWN_SEQUENCE_STAGES.IDLE,
      progress: 0,
      stageProgress: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      yawOffset: 0,
      actualSpeed: 0,
      moved: false,
      fpEyeOffsetY: 0,
      fpCameraPitch: 0,
      fpCameraRoll: 0,
      turnEnvelope: 0,
      recoverEnvelope: 0,
      braceEnvelope: 0,
      impactJoltEnvelope: 0,
      balanceLossEnvelope: 0,
      staggerSwayWave: 0,
      stepReachEnvelope: 0,
      stepLiftEnvelope: 0,
      turnSign: 1,
      slope: 0,
      elevatorY: 0,
      vibrationY: 0,
      descentProgress: 0,
      impactProgress: 0,
      impactTriggered: false,
    }
  }

  start(maze, options = {}) {
    if (this.isDisposed || this.config.enabled === false || !maze?.start) {
      this._active = false
      this._stage = SPAWN_SEQUENCE_STAGES.COMPLETED
      return false
    }

    const trajectory = resolveElevatorExitTrajectory(maze, {
      exitYaw: options?.exitYaw,
      exitDistance: this.config.exitDistance,
    })
    if (!trajectory) {
      this._active = false
      this._stage = SPAWN_SEQUENCE_STAGES.COMPLETED
      return false
    }

    this._maze = maze
    this._startX = trajectory.startX
    this._startY = trajectory.startY
    this._startZ = trajectory.startZ
    this._endX = trajectory.endX
    this._endY = trajectory.endY
    this._endZ = trajectory.endZ
    this._dirX = trajectory.dirX
    this._dirZ = trajectory.dirZ
    this._exitYaw = trajectory.exitYaw
    this._exitDistance = trajectory.exitDistance
    this._hasOpenExit = trajectory.hasOpenExit

    if (Number.isFinite(options?.walkSpeed) && options.walkSpeed > 0) {
      this._walkSpeedRef = options.walkSpeed
    }

    const staggerOffset = Number.isFinite(options?.initialYaw)
      ? wrapAngleDiff(options.initialYaw, this._exitYaw)
      : Number.isFinite(this.config.initialStaggerYawOffset)
        ? this.config.initialStaggerYawOffset
        : 0.38

    this._initialYawOffset = staggerOffset
    this._currentYawOffset = staggerOffset
    const rawElevationY = options?.startElevationY ?? this.config.startElevationY
    this._startElevationY = Number.isFinite(Number(rawElevationY))
      ? Math.max(0, Number(rawElevationY))
      : 8.4
    const rawDescentDur = options?.descentDuration ?? this.config.descentDuration
    this._descentDuration =
      this._startElevationY > 0.05 && Number(rawDescentDur) > 0
        ? Math.max(0.15, Number(rawDescentDur))
        : 0
    this._impactDuration =
      this._descentDuration > 0
        ? Math.max(0.08, Number(options?.impactDuration ?? this.config.impactDuration) || 0.22)
        : 0
    this._preExitSettleDuration =
      this._descentDuration > 0
        ? Math.max(
            0.08,
            Number(options?.settleDurationPreExit ?? this.config.settleDurationPreExit) || 0.42
          )
        : 0

    this._recoverDuration = Math.max(0.05, Number(this.config.recoverDuration) || 0.46)
    const needsVisibleTurn = Math.abs(this._initialYawOffset) > 0.015
    this._turnDuration = needsVisibleTurn
      ? Math.max(0.12, Number(this.config.turnDuration) || 0.34)
      : 0
    this._walkDuration = this._hasOpenExit
      ? Math.max(0.2, Number(this.config.walkDuration) || 1.08)
      : 0
    this._settleDuration = this._hasOpenExit
      ? Math.max(0.08, Number(this.config.settleDuration) || 0.22)
      : 0.14
    this._totalDuration =
      this._descentDuration +
      this._impactDuration +
      this._preExitSettleDuration +
      this._recoverDuration +
      this._turnDuration +
      this._walkDuration +
      this._settleDuration

    this._elapsed = 0
    this._active = true
    this._impactFired = false
    const hasArrivalDescent = this._descentDuration > 0
    this._stage = hasArrivalDescent
      ? SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND
      : SPAWN_SEQUENCE_STAGES.IDLE_RECOVER
    this._elevatorY = hasArrivalDescent ? this._startElevationY : 0
    this._vibrationY = 0

    const out = this._stepOutput
    out.active = true
    out.completed = false
    out.stage = this._stage
    out.progress = 0
    out.stageProgress = 0
    out.x = this._startX
    out.y = this._startY + this._elevatorY
    out.z = this._startZ
    out.yaw = this._exitYaw + this._initialYawOffset
    out.yawOffset = this._initialYawOffset
    out.actualSpeed = 0
    out.moved = false
    out.fpEyeOffsetY = 0
    out.fpCameraPitch = 0
    out.fpCameraRoll = 0
    out.turnEnvelope = 0
    out.recoverEnvelope = 0
    out.braceEnvelope = 0
    out.impactJoltEnvelope = 0
    out.balanceLossEnvelope = 0
    out.staggerSwayWave = 0
    out.stepReachEnvelope = 0
    out.stepLiftEnvelope = 0
    out.turnSign = this._initialYawOffset >= 0 ? 1 : -1
    out.slope = 0
    out.elevatorY = this._elevatorY
    out.vibrationY = 0
    out.descentProgress = hasArrivalDescent ? 0 : 1
    out.impactProgress = hasArrivalDescent ? 0 : 1
    out.impactTriggered = false

    return true
  }

  cancel() {
    const wasActive = this._active
    this._active = false
    this._stage = SPAWN_SEQUENCE_STAGES.IDLE
    this._elapsed = 0
    this._currentYawOffset = 0
    this._elevatorY = 0
    this._vibrationY = 0
    this._impactFired = false
    this._stepOutput.active = false
    this._stepOutput.completed = false
    this._stepOutput.stage = SPAWN_SEQUENCE_STAGES.IDLE
    this._stepOutput.y = this._startY
    this._stepOutput.actualSpeed = 0
    this._stepOutput.moved = false
    this._stepOutput.fpEyeOffsetY = 0
    this._stepOutput.fpCameraPitch = 0
    this._stepOutput.fpCameraRoll = 0
    this._stepOutput.yawOffset = 0
    this._stepOutput.recoverEnvelope = 0
    this._stepOutput.braceEnvelope = 0
    this._stepOutput.impactJoltEnvelope = 0
    this._stepOutput.balanceLossEnvelope = 0
    this._stepOutput.staggerSwayWave = 0
    this._stepOutput.stepReachEnvelope = 0
    this._stepOutput.stepLiftEnvelope = 0
    this._stepOutput.turnEnvelope = 0
    this._stepOutput.slope = 0
    this._stepOutput.elevatorY = 0
    this._stepOutput.vibrationY = 0
    this._stepOutput.descentProgress = 0
    this._stepOutput.impactProgress = 0
    this._stepOutput.impactTriggered = false
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
      exitYaw: this._exitYaw,
      actualSpeed: o.actualSpeed,
      moved: o.moved,
      elevatorY: o.elevatorY,
      vibrationY: o.vibrationY,
      descentProgress: o.descentProgress,
      impactProgress: o.impactProgress,
      impactTriggered: o.impactTriggered,
      impactJoltEnvelope: o.impactJoltEnvelope,
      balanceLossEnvelope: o.balanceLossEnvelope,
      staggerSwayWave: o.staggerSwayWave,
      stepReachEnvelope: o.stepReachEnvelope,
      stepLiftEnvelope: o.stepLiftEnvelope,
    }
  }

  /**
   * Advances the elevator arrival + step-off sequence by `delta` seconds.
   * Performs zero heap allocations and writes directly to `this._stepOutput`.
   */
  update(delta = 0, options = {}) {
    const out = this._stepOutput
    if (this.isDisposed || !this._active) {
      out.active = false
      out.completed = false
      out.impactTriggered = false
      return out
    }

    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0
    this._elapsed = Math.min(this._totalDuration, this._elapsed + dt)

    const descEnd = this._descentDuration
    const impactEnd = descEnd + this._impactDuration
    const preSettleEnd = impactEnd + this._preExitSettleDuration
    const recoverEnd = preSettleEnd + this._recoverDuration
    const turnEnd = recoverEnd + this._turnDuration
    const walkEnd = turnEnd + this._walkDuration
    const total = this._totalDuration

    const reducedMotion = Boolean(options?.reducedMotion)
    let x = this._startX
    let z = this._startZ
    let speed = 0
    let moved = false
    let yawOffset = this._initialYawOffset
    let stageProgress
    let recoverEnvelope = 0
    let braceEnvelope = 0
    let impactJoltEnvelope = 0
    let balanceLossEnvelope = 0
    let staggerSwayWave = 0
    let stepReachEnvelope = 0
    let stepLiftEnvelope = 0
    let turnEnvelope = 0
    let fpEyeOffsetY = 0
    let fpCameraPitch = 0
    let fpCameraRoll = 0
    let elevatorY = 0
    let vibrationY = 0
    let descentProgress = 1
    let impactProgress = 1
    let impactTriggered = false

    if (this._elapsed < descEnd && this._descentDuration > 0) {
      this._stage = SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND
      stageProgress = clamp(this._elapsed / this._descentDuration, 0, 1)
      descentProgress = stageProgress
      impactProgress = 0
      // Smooth weighty shaft descent that lands with controlled contact velocity at u=1
      const curveU = 0.35 * stageProgress + 0.65 * smoothstep3(stageProgress)
      elevatorY = this._startElevationY * (1 - curveU)
      vibrationY = reducedMotion
        ? 0
        : Math.sin(this._elapsed * 42) * 0.004 * Math.sin(Math.PI * stageProgress)
      fpEyeOffsetY = reducedMotion ? 0 : vibrationY * 0.55
    } else if (this._elapsed < impactEnd && this._impactDuration > 0) {
      this._stage = SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT
      stageProgress = clamp((this._elapsed - descEnd) / this._impactDuration, 0, 1)
      descentProgress = 1
      impactProgress = stageProgress
      if (!this._impactFired) {
        this._impactFired = true
        impactTriggered = true
      }
      elevatorY = 0
      vibrationY = reducedMotion
        ? 0
        : -0.022 *
          Math.exp(-3.2 * stageProgress) *
          Math.sin(stageProgress * Math.PI * 3.0) *
          (1 - stageProgress)
    } else if (this._elapsed < preSettleEnd && this._preExitSettleDuration > 0) {
      this._stage = SPAWN_SEQUENCE_STAGES.ELEVATOR_SETTLE
      stageProgress = clamp(
        (this._elapsed - impactEnd) / this._preExitSettleDuration,
        0,
        1
      )
      if (!this._impactFired && this._impactDuration > 0) {
        this._impactFired = true
        impactTriggered = true
      }
      descentProgress = 1
      impactProgress = 1
      elevatorY = 0
      vibrationY = 0
    } else if (this._elapsed < recoverEnd) {
      this._stage = SPAWN_SEQUENCE_STAGES.IDLE_RECOVER
      if (!this._impactFired && this._impactDuration > 0) {
        this._impactFired = true
        impactTriggered = true
      }
      stageProgress = clamp(
        (this._elapsed - preSettleEnd) / this._recoverDuration,
        0,
        1
      )
      if (this._descentDuration === 0) {
        // Standalone Phase 2 compatibility when starting flush without shaft descent
        recoverEnvelope = Math.sin(Math.PI * Math.pow(stageProgress, 0.7))
        fpEyeOffsetY = reducedMotion ? 0 : -0.042 * recoverEnvelope
      }
    } else if (this._elapsed < turnEnd) {
      this._stage = SPAWN_SEQUENCE_STAGES.TURN_TO_EXIT
      stageProgress = clamp(
        (this._elapsed - recoverEnd) / this._turnDuration,
        0,
        1
      )
      const smoothTurn = smoothstep3(stageProgress)
      yawOffset = this._initialYawOffset * (1 - smoothTurn)
      turnEnvelope = Math.sin(Math.PI * stageProgress)
      fpEyeOffsetY = reducedMotion ? 0 : -0.012 * turnEnvelope
    } else if (this._elapsed < walkEnd) {
      this._stage = SPAWN_SEQUENCE_STAGES.WALK_OFF
      stageProgress = clamp((this._elapsed - turnEnd) / this._walkDuration, 0, 1)
      yawOffset = 0
      const distProgress = quinticProgress(stageProgress)
      const dist = this._exitDistance * distProgress
      x = this._startX + this._dirX * dist
      z = this._startZ + this._dirZ * dist
      speed = (this._exitDistance / this._walkDuration) * quinticDerivative(stageProgress)
      moved = speed > 0.05
      if (!reducedMotion) {
        // Gentle footstep cadence bob that fades smoothly at start/end of walk
        const bobEnvelope = Math.sin(Math.PI * stageProgress)
        fpEyeOffsetY = -0.016 * Math.abs(Math.sin(stageProgress * Math.PI * 3.0)) * bobEnvelope
      }
    } else if (this._elapsed < total) {
      this._stage = SPAWN_SEQUENCE_STAGES.SETTLE
      stageProgress = clamp((this._elapsed - walkEnd) / this._settleDuration, 0, 1)
      yawOffset = 0
      x = this._endX
      z = this._endZ
      speed = 0
      moved = false
      fpEyeOffsetY = reducedMotion ? 0 : -0.008 * Math.sin(Math.PI * stageProgress)
    } else {
      this._stage = SPAWN_SEQUENCE_STAGES.COMPLETED
      this._active = false
      stageProgress = 1
      yawOffset = 0
      x = this._endX
      z = this._endZ
      speed = 0
      moved = false
      fpEyeOffsetY = 0
    }

    // Continuous procedural landing impact + balance-loss + corrective-step recovery
    // Begins strictly on elevator touchdown (ELEVATOR_IMPACT) and completes before IDLE_RECOVER pause
    if (
      this._descentDuration > 0 &&
      this._elapsed >= descEnd &&
      this._elapsed < preSettleEnd
    ) {
      const reactTime = this._elapsed - descEnd
      const reactSpan = Math.max(0.25, preSettleEnd - descEnd)
      const u = clamp(reactTime / reactSpan, 0, 1)

      const joltU = clamp(u / 0.84, 0, 1)
      const joltShock = 0.4 * Math.exp(-14 * joltU) * (1 - joltU)
      const joltBody =
        (Math.sin(Math.PI * Math.pow(joltU, 0.52)) * Math.pow(1 - joltU, 1.45)) /
        0.78
      impactJoltEnvelope = clamp(joltShock + joltBody, 0, 1)

      const balU = clamp(u / 0.96, 0, 1)
      const balShock = 0.14 * Math.exp(-10 * balU) * (1 - balU)
      const balBody =
        (Math.sin(Math.PI * Math.pow(balU, 0.55)) * Math.pow(1 - balU, 1.25)) /
        0.73
      balanceLossEnvelope = clamp(balShock + balBody, 0, 1)

      // Stagger directional lurch -> corrective catch counterweight -> re-center
      staggerSwayWave =
        balanceLossEnvelope * Math.sin(balU * Math.PI * 1.65)

      // Corrective catch step [0.10 .. 0.88] lifts boot briefly off deck, plants to catch weight, and returns cleanly
      const stepU = clamp((u - 0.1) / 0.78, 0, 1)
      if (stepU > 0 && stepU < 1) {
        stepReachEnvelope = Math.sin(Math.PI * smoothstep3(stepU))
        if (stepU < 0.38) {
          stepLiftEnvelope = Math.sin(Math.PI * (stepU / 0.38))
        } else if (stepU > 0.66) {
          stepLiftEnvelope = 0.68 * Math.sin(Math.PI * ((stepU - 0.66) / 0.34))
        }
      }

      braceEnvelope = impactJoltEnvelope

      if (!reducedMotion) {
        fpEyeOffsetY = -0.105 * impactJoltEnvelope - 0.024 * balanceLossEnvelope
        fpCameraPitch =
          -0.068 * impactJoltEnvelope +
          0.016 * Math.sin(balanceLossEnvelope * Math.PI) * (1 - impactJoltEnvelope)
        fpCameraRoll = 0.032 * staggerSwayWave + 0.008 * vibrationY * 45
      }
    }

    this._currentYawOffset = yawOffset
    this._elevatorY = elevatorY
    this._vibrationY = vibrationY
    const baseFloorY = getElevatorFloorHeightAtWorld(x, z, this._maze)
    const carOffsetY = elevatorY + (reducedMotion ? 0 : vibrationY)
    const y = baseFloorY + carOffsetY

    // Sample local forward/backward floor heights along exit vector for ramp foot compliance
    const sampleOffset = 0.22
    const hAhead = getElevatorFloorHeightAtWorld(
      x + this._dirX * sampleOffset,
      z + this._dirZ * sampleOffset,
      this._maze
    )
    const hBehind = getElevatorFloorHeightAtWorld(
      x - this._dirX * sampleOffset,
      z - this._dirZ * sampleOffset,
      this._maze
    )
    const slope = (hAhead - hBehind) / (sampleOffset * 2)

    out.active = this._active
    out.completed = !this._active && this._stage === SPAWN_SEQUENCE_STAGES.COMPLETED
    out.stage = this._stage
    out.progress = total > 0 ? clamp(this._elapsed / total, 0, 1) : 1
    out.stageProgress = stageProgress
    out.x = x
    out.y = y
    out.z = z
    out.yaw = this._exitYaw + yawOffset
    out.yawOffset = yawOffset
    out.actualSpeed = speed
    out.moved = moved
    out.fpEyeOffsetY = fpEyeOffsetY
    out.fpCameraPitch = fpCameraPitch
    out.fpCameraRoll = fpCameraRoll
    out.recoverEnvelope = recoverEnvelope
    out.braceEnvelope = braceEnvelope
    out.impactJoltEnvelope = impactJoltEnvelope
    out.balanceLossEnvelope = balanceLossEnvelope
    out.staggerSwayWave = staggerSwayWave
    out.stepReachEnvelope = stepReachEnvelope
    out.stepLiftEnvelope = stepLiftEnvelope
    out.turnEnvelope = turnEnvelope
    out.turnSign = this._initialYawOffset >= 0 ? 1 : -1
    out.slope = slope
    out.elevatorY = elevatorY
    out.vibrationY = reducedMotion ? 0 : vibrationY
    out.descentProgress = descentProgress
    out.impactProgress = impactProgress
    out.impactTriggered = impactTriggered

    return out
  }

  /**
   * Applies zero-allocation additive impact reaction, balance recovery, turn
   * weight-shift, and ramp slope foot/ankle compliance on top of
   * `PlayerAnimator.update()`, keeping the planted boot flush with deck height.
   */
  applyPoseAdjustments(playerGroup) {
    const rig = playerGroup?.userData?.isDisposed
      ? null
      : playerGroup?.userData?.rig
    if (!rig) return

    const o = this._stepOutput
    const recover = o.recoverEnvelope
    const jolt = o.impactJoltEnvelope
    const bal = o.balanceLossEnvelope
    const sway = o.staggerSwayWave
    const stepReach = o.stepReachEnvelope
    const stepLift = o.stepLiftEnvelope
    const turn = o.turnEnvelope
    const slopeMag = clamp(-o.slope / 0.16, 0, 1)

    if (
      recover <= 1e-5 &&
      jolt <= 1e-5 &&
      bal <= 1e-5 &&
      stepReach <= 1e-5 &&
      turn <= 1e-5 &&
      slopeMag <= 1e-5
    ) {
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

    // 1. Impact pelvis compression, balance-loss shift & turn weight transfer
    if (pelvis) {
      if (pelvis.position) {
        pelvis.position.x += 0.038 * sway + 0.024 * turn * turnSign
        pelvis.position.z += 0.024 * jolt - 0.036 * stepReach
      }
      pelvis.rotation.x += -0.08 * jolt - 0.03 * recover
      pelvis.rotation.y += -0.11 * sway - 0.095 * turn * turnSign
      pelvis.rotation.z += 0.068 * sway + 0.045 * turn * turnSign
    }

    // 2. Leg impact shock absorption, corrective stagger catch step & ramp brace
    const recoverHipAdd = 0.12 * recover
    const recoverKneeAdd = -0.18 * recover
    const slopeKneeAdd = -0.075 * slopeMag
    const turnStep = turn > 1e-5 ? turn : 0
    const leftTurnHip = turnStep * (turnSign > 0 ? 0.16 : -0.06)
    const rightTurnHip = turnStep * (turnSign > 0 ? -0.06 : 0.16)
    const leftTurnKnee = turnStep * (turnSign > 0 ? -0.22 : -0.05)
    const rightTurnKnee = turnStep * (turnSign > 0 ? -0.05 : -0.22)

    const leftImpactHipX = 0.34 * jolt + 0.34 * stepReach + 0.14 * stepLift
    const rightImpactHipX = 0.3 * jolt - 0.15 * stepReach
    const leftImpactKneeX = -0.56 * jolt - 0.24 * stepLift - 0.08 * stepReach
    const rightImpactKneeX = -0.52 * jolt - 0.1 * bal

    if (leftHip) {
      leftHip.rotation.x += leftImpactHipX + recoverHipAdd + leftTurnHip + 0.04 * slopeMag
      leftHip.rotation.y += 0.085 * stepReach
      leftHip.rotation.z += -0.068 * bal - 0.035 * stepReach
    }
    if (leftKnee) {
      leftKnee.rotation.x = clamp(
        leftKnee.rotation.x + leftImpactKneeX + recoverKneeAdd + leftTurnKnee + slopeKneeAdd,
        -1.75,
        0
      )
    }
    if (leftAnkle) {
      const slopeAnkleAdd = -0.09 * slopeMag
      const impactAnkleAdd = 0.24 * jolt + 0.11 * bal - 0.18 * stepLift
      leftAnkle.rotation.x = clamp(
        leftAnkle.rotation.x + impactAnkleAdd + 0.06 * recover + 0.04 * turnStep + slopeAnkleAdd,
        -0.64,
        0.52
      )
      leftAnkle.rotation.z += 0.045 * sway
    }

    if (rightHip) {
      rightHip.rotation.x += rightImpactHipX + recoverHipAdd + rightTurnHip + 0.04 * slopeMag
      rightHip.rotation.y += -0.05 * bal
      rightHip.rotation.z += 0.068 * bal
    }
    if (rightKnee) {
      rightKnee.rotation.x = clamp(
        rightKnee.rotation.x + rightImpactKneeX + recoverKneeAdd + rightTurnKnee + slopeKneeAdd,
        -1.75,
        0
      )
    }
    if (rightAnkle) {
      const slopeAnkleAdd = -0.09 * slopeMag
      const impactAnkleAdd = 0.23 * jolt + 0.1 * bal + 0.06 * stepReach
      rightAnkle.rotation.x = clamp(
        rightAnkle.rotation.x + impactAnkleAdd + 0.06 * recover + 0.04 * turnStep + slopeAnkleAdd,
        -0.64,
        0.52
      )
      rightAnkle.rotation.z += 0.045 * sway
    }

    // 3. Upper body forward inertial pitch, reactive twist/roll & instinctive arm counterbalance
    if (spine) {
      spine.rotation.x += -0.25 * bal - 0.08 * jolt - 0.075 * recover + 0.03 * slopeMag
      spine.rotation.y += 0.14 * sway + 0.11 * turn * turnSign - 0.045 * recover * turnSign
      spine.rotation.z += -0.085 * sway - 0.032 * turn * turnSign
    }

    if (leftShoulder) {
      leftShoulder.rotation.x +=
        0.34 * bal + 0.16 * sway + 0.11 * recover - 0.12 * turnStep * turnSign
      leftShoulder.rotation.y += -0.14 * bal - 0.06 * sway
      leftShoulder.rotation.z += -0.38 * bal - 0.09 * Math.abs(sway) - 0.055 * recover - 0.03 * turnStep
    }
    if (leftElbow) {
      leftElbow.rotation.x = clamp(
        leftElbow.rotation.x + 0.44 * bal + 0.24 * recover + 0.14 * turnStep,
        0.08,
        1.75
      )
    }
    if (leftWrist) {
      leftWrist.rotation.x += -0.14 * bal + 0.04 * recover
      leftWrist.rotation.z += 0.09 * bal
    }

    if (rightShoulder) {
      rightShoulder.rotation.x +=
        0.28 * bal - 0.16 * sway + 0.08 * recover + 0.12 * turnStep * turnSign
      rightShoulder.rotation.y += 0.14 * bal - 0.06 * sway
      rightShoulder.rotation.z += 0.36 * bal + 0.09 * Math.abs(sway) + 0.055 * recover + 0.03 * turnStep
    }
    if (rightElbow) {
      rightElbow.rotation.x = clamp(
        rightElbow.rotation.x + 0.38 * bal + 0.2 * recover + 0.14 * turnStep,
        0.08,
        1.75
      )
    }
    if (rightWrist) {
      rightWrist.rotation.x += -0.14 * bal + 0.04 * recover
      rightWrist.rotation.z += -0.09 * bal
    }

    // 4. Head/neck initial whip then active horizon counter-stabilization & turn glance
    if (neck) {
      neck.rotation.x += -0.065 * jolt + 0.15 * bal + 0.045 * recover
      neck.rotation.y += (-0.16 * recover - 0.08 * turn) * turnSign - 0.05 * sway
      neck.rotation.z += -0.045 * sway
    }
    if (head) {
      head.rotation.x += -0.055 * jolt + 0.14 * bal + 0.045 * recover
      head.rotation.y += (-0.22 * recover - 0.14 * turn) * turnSign - 0.07 * sway
      head.rotation.z += -0.055 * sway
    }

    // 5. Recompute exact grounded pelvis height so lowest boot stays flush with floor (no sinking/floating)
    if (pelvis && pelvis.position && leftHip && leftKnee && leftAnkle && rightHip && rightKnee && rightAnkle) {
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
