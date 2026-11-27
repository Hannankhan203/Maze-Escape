export const PLAYER_ANIM_STATES = {
  IDLE: 'idle',
  WALK: 'walk',
  SPRINT: 'sprint',
}

export const RUBBLE_ANIM_MODES = {
  NONE: 'none',
  PICKUP: 'pickup',
  CARRY: 'carry',
  PLACE: 'place',
}

export const FURNITURE_ANIM_MODES = {
  NONE: 'none',
  GRIP: 'grip',
  PUSH_DRAG: 'push_drag',
  RELEASE: 'release',
}

export const DEFAULT_PLAYER_ANIM_CONFIG = {
  idleFrequency: 2.1,
  idleBobAmplitude: 0.008,
  idleChestBreathLift: 0.0032,
  idleArmSway: 0.016,
  idleTorsoPitch: 0.013,
  idleElbowBend: 0.19,
  idleKneeBend: 0.045,
  idlePelvisRoll: 0.016,
  idlePelvisTwist: 0.018,

  walkFrequency: 8.6,
  walkLegSwing: 0.48,
  walkArmSwing: 0.37,
  walkBobAmplitude: 0.03,
  walkTorsoLean: -0.046,
  walkTorsoTwist: 0.06,
  walkTorsoRoll: 0.018,
  walkPelvisTwist: 0.048,
  walkPelvisRoll: 0.028,
  walkKneeBaseBend: 0.045,
  walkKneeSwingBend: 0.84,
  walkKneeStanceBend: 0.15,
  walkHeelStrikePitch: 0.23,
  walkPushOffPitch: -0.36,
  walkElbowBaseBend: 0.33,
  walkElbowSwingBend: 0.24,

  sprintFrequency: 13.6,
  sprintLegSwing: 0.82,
  sprintArmSwing: 0.78,
  sprintArmBendPitch: 0.16,
  sprintBobAmplitude: 0.058,
  sprintTorsoLean: -0.14,
  sprintTorsoTwist: 0.108,
  sprintTorsoRoll: 0.03,
  sprintPelvisLean: -0.055,
  sprintPelvisTwist: 0.088,
  sprintPelvisRoll: 0.044,
  sprintHipDrive: 0.22,
  sprintKneeBaseBend: 0.1,
  sprintKneeSwingBend: 1.38,
  sprintKneeStanceBend: 0.24,
  sprintHeelStrikePitch: 0.16,
  sprintPushOffPitch: -0.54,
  sprintElbowBaseBend: 1.22,
  sprintElbowSwingBend: 0.34,
  sprintFlightLift: 0.038,

  headCounterPitchFactor: 0.56,
  stateBlendRate: 11.0,
  stopDampRate: 24.0,
}

const TWO_PI = Math.PI * 2
const THIGH_LENGTH = 0.425
const SHIN_LENGTH = 0.395
const BOOT_SOLE_HEIGHT = 0.1
const BOOT_TOE_EXTENT = 0.18
const BOOT_HEEL_EXTENT = 0.065
const HIP_OFFSET_X = 0.094
const DEFAULT_PELVIS_Y =
  THIGH_LENGTH + SHIN_LENGTH + BOOT_SOLE_HEIGHT

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function smoothUnitBell(raw) {
  return raw * raw * (3 - 2 * raw)
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

function resetPivotRotation(pivot) {
  if (pivot?.rotation) {
    pivot.rotation.set(0, 0, 0)
  }
}

/**
 * Frame-rate-independent, zero-allocation procedural humanoid animator.
 * Drives idle breathing/weight-shift, walking, and sprinting gaits directly on
 * the `buildPlayer()` 16-pivot articulated rig (with legacy rig alias fallback),
 * incorporating phase-lagged secondary motion, loading-response knee yield,
 * heel-to-toe foot roll, pelvic figure-8 sway, and subtle organic asymmetry.
 */
export class PlayerAnimator {
  constructor(playerGroup = null, config = {}) {
    this.isDisposed = false
    this.config = {
      ...DEFAULT_PLAYER_ANIM_CONFIG,
      ...(config || {}),
    }

    this.playerGroup = null
    this.rig = null
    this.state = PLAYER_ANIM_STATES.IDLE
    this.walkWeight = 0
    this.sprintWeight = 0
    this.stridePhase = 0
    this.idlePhase = 0
    // Independent wrapped secondary phases avoid wrap discontinuities in non-integer harmonics
    this._idleWeightPhase = 0
    this._idleScanPhase = 0
    this._idleMicroPhase = 0

    // Procedural manual rubble handling animation channels (zero per-frame allocations)
    this._rubbleMode = RUBBLE_ANIM_MODES.NONE
    this._rubbleProgress = 0
    this._rubbleBlend = 0
    this._rubbleCrouch = 0
    this._rubbleReach = 0
    this._rubbleCarry = 0
    this._rubbleEffort = 0
    this._rubbleGazeDown = 0
    this._rubbleGripWidth = 0.34
    this._rubbleReleaseOpen = 0

    // Procedural manual furniture pushing / dragging animation channels (zero per-frame allocations)
    this._furnitureMode = FURNITURE_ANIM_MODES.NONE
    this._furnitureProgress = 0
    this._furnitureBlend = 0
    this._furnitureCrouch = 0
    this._furnitureReach = 0
    this._furnitureBrace = 0
    this._furniturePushSign = 0
    this._furnitureStrafeSign = 0
    this._furnitureHeightNorm = 0
    this._furnitureEffort = 0
    this._furnitureGazeDown = 0
    this._furnitureReleaseOpen = 0

    if (playerGroup) {
      this.setPlayerGroup(playerGroup)
    }
  }

  setPlayerGroup(playerGroup) {
    if (this.isDisposed) return
    if (this.rig && !this.playerGroup?.userData?.isDisposed) {
      this._applyNeutralPose()
    }
    const validGroup =
      playerGroup && !playerGroup.userData?.isDisposed ? playerGroup : null
    this.playerGroup = validGroup
    this.rig = validGroup?.userData?.rig || null
    this.reset()
  }

  updateConfig(partialConfig = {}) {
    if (this.isDisposed || !partialConfig || typeof partialConfig !== 'object') {
      return { ...this.config }
    }
    this.config = {
      ...this.config,
      ...partialConfig,
    }
    return { ...this.config }
  }

  getState() {
    const locomotionWeight = clamp(this.walkWeight + this.sprintWeight, 0, 1)
    return {
      state: this.state,
      walkWeight: this.walkWeight,
      sprintWeight: this.sprintWeight,
      locomotionWeight,
      stridePhase: this.stridePhase,
      idlePhase: this.idlePhase,
    }
  }

  getRubbleState() {
    return {
      rubbleMode: this._rubbleMode,
      rubbleProgress: this._rubbleProgress,
      rubbleBlend: this._rubbleBlend,
      rubbleCrouch: this._rubbleCrouch,
      rubbleCarry: this._rubbleCarry,
      rubbleReach: this._rubbleReach,
    }
  }

  getFurnitureState() {
    return {
      furnitureMode: this._furnitureMode,
      furnitureProgress: this._furnitureProgress,
      furnitureBlend: this._furnitureBlend,
      furnitureCrouch: this._furnitureCrouch,
      furnitureReach: this._furnitureReach,
      furnitureBrace: this._furnitureBrace,
      furniturePushSign: this._furniturePushSign,
      furnitureStrafeSign: this._furnitureStrafeSign,
      furnitureHeightNorm: this._furnitureHeightNorm,
      furnitureEffort: this._furnitureEffort,
    }
  }

  _applyNeutralPose() {
    const rig = this.rig
    if (!rig) return

    const restPose = rig.restPose
    const restPelvisY = Number.isFinite(restPose?.pelvisY)
      ? restPose.pelvisY
      : DEFAULT_PELVIS_Y
    const restSpineY = Number.isFinite(restPose?.spineY)
      ? restPose.spineY
      : Number.isFinite(restPose?.upperBodyY)
        ? restPose.upperBodyY
        : 0.05
    const restLeftLegY = Number.isFinite(restPose?.leftLegY)
      ? restPose.leftLegY
      : 0
    const restRightLegY = Number.isFinite(restPose?.rightLegY)
      ? restPose.rightLegY
      : 0

    const pelvis = rig.pelvisPivot
    const spine = rig.spinePivot || rig.upperBodyPivot
    const neck = rig.neckPivot
    const head = rig.headPivot

    const leftShoulder = rig.leftShoulderPivot || rig.leftArmPivot
    const rightShoulder = rig.rightShoulderPivot || rig.rightArmPivot
    const leftHip = rig.leftHipPivot || rig.leftLegPivot
    const rightHip = rig.rightHipPivot || rig.rightLegPivot

    if (pelvis) {
      if (pelvis.position) {
        pelvis.position.x = 0
        pelvis.position.y = restPelvisY
        pelvis.position.z = 0
      }
      resetPivotRotation(pelvis)
    }

    if (spine) {
      if (spine.position) spine.position.y = restSpineY
      resetPivotRotation(spine)
    }
    if (rig.upperBodyPivot && rig.upperBodyPivot !== spine) {
      if (rig.upperBodyPivot.position) {
        rig.upperBodyPivot.position.y = restSpineY
      }
      resetPivotRotation(rig.upperBodyPivot)
    }

    resetPivotRotation(neck)
    resetPivotRotation(head)

    const restLeftShoulderY = Number.isFinite(restPose?.leftShoulderY)
      ? restPose.leftShoulderY
      : 0.36
    const restRightShoulderY = Number.isFinite(restPose?.rightShoulderY)
      ? restPose.rightShoulderY
      : 0.36

    if (leftShoulder?.position) {
      leftShoulder.position.y = restLeftShoulderY
      leftShoulder.position.z = 0
    }
    resetPivotRotation(leftShoulder)
    if (rig.leftArmPivot && rig.leftArmPivot !== leftShoulder) {
      resetPivotRotation(rig.leftArmPivot)
    }
    resetPivotRotation(rig.leftElbowPivot)
    resetPivotRotation(rig.leftWristPivot)

    if (rightShoulder?.position) {
      rightShoulder.position.y = restRightShoulderY
      rightShoulder.position.z = 0
    }
    resetPivotRotation(rightShoulder)
    if (rig.rightArmPivot && rig.rightArmPivot !== rightShoulder) {
      resetPivotRotation(rig.rightArmPivot)
    }
    resetPivotRotation(rig.rightElbowPivot)
    resetPivotRotation(rig.rightWristPivot)

    if (leftHip) {
      if (leftHip.position) leftHip.position.y = restLeftLegY
      resetPivotRotation(leftHip)
    }
    if (rig.leftLegPivot && rig.leftLegPivot !== leftHip) {
      if (rig.leftLegPivot.position) rig.leftLegPivot.position.y = restLeftLegY
      resetPivotRotation(rig.leftLegPivot)
    }
    resetPivotRotation(rig.leftKneePivot)
    resetPivotRotation(rig.leftAnklePivot)

    if (rightHip) {
      if (rightHip.position) rightHip.position.y = restRightLegY
      resetPivotRotation(rightHip)
    }
    if (rig.rightLegPivot && rig.rightLegPivot !== rightHip) {
      if (rig.rightLegPivot.position) {
        rig.rightLegPivot.position.y = restRightLegY
      }
      resetPivotRotation(rig.rightLegPivot)
    }
    resetPivotRotation(rig.rightKneePivot)
    resetPivotRotation(rig.rightAnklePivot)
  }

  reset() {
    this.state = PLAYER_ANIM_STATES.IDLE
    this.walkWeight = 0
    this.sprintWeight = 0
    this.stridePhase = 0
    this.idlePhase = 0
    this._idleWeightPhase = 0
    this._idleScanPhase = 0
    this._idleMicroPhase = 0
    this._rubbleMode = RUBBLE_ANIM_MODES.NONE
    this._rubbleProgress = 0
    this._rubbleBlend = 0
    this._rubbleCrouch = 0
    this._rubbleReach = 0
    this._rubbleCarry = 0
    this._rubbleEffort = 0
    this._rubbleGazeDown = 0
    this._rubbleGripWidth = 0.34
    this._rubbleReleaseOpen = 0
    this._furnitureMode = FURNITURE_ANIM_MODES.NONE
    this._furnitureProgress = 0
    this._furnitureBlend = 0
    this._furnitureCrouch = 0
    this._furnitureReach = 0
    this._furnitureBrace = 0
    this._furniturePushSign = 0
    this._furnitureStrafeSign = 0
    this._furnitureHeightNorm = 0
    this._furnitureEffort = 0
    this._furnitureGazeDown = 0
    this._furnitureReleaseOpen = 0
    this._applyNeutralPose()
  }

  /**
   * Advances procedural idle/walk/sprint blend weights and updates limb pivots.
   * Performs zero heap or Three.js object allocations per call.
   */
  update(delta = 0, motion = null) {
    if (this.isDisposed) return

    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0
    const cfg = this.config

    const actualSpeed =
      motion && Number.isFinite(motion.actualSpeed)
        ? Math.max(0, motion.actualSpeed)
        : 0
    const isMoving = Boolean(motion?.moved && actualSpeed > 0.05)
    const isSprinting = isMoving && Boolean(motion?.isSprinting)

    const nextState = !isMoving
      ? PLAYER_ANIM_STATES.IDLE
      : isSprinting
        ? PLAYER_ANIM_STATES.SPRINT
        : PLAYER_ANIM_STATES.WALK

    this.state = nextState

    if (dt > 0) {
      if (nextState === PLAYER_ANIM_STATES.IDLE) {
        const stopDecay = Math.exp(-cfg.stopDampRate * dt)
        this.walkWeight *= stopDecay
        this.sprintWeight *= stopDecay

        if (this.walkWeight + this.sprintWeight < 0.004) {
          this.walkWeight = 0
          this.sprintWeight = 0
          this.stridePhase = 0
        }

        this.idlePhase = (this.idlePhase + cfg.idleFrequency * dt) % TWO_PI
        this._idleWeightPhase =
          (this._idleWeightPhase + cfg.idleFrequency * 0.43 * dt) % TWO_PI
        this._idleScanPhase =
          (this._idleScanPhase + cfg.idleFrequency * 0.27 * dt) % TWO_PI
        this._idleMicroPhase =
          (this._idleMicroPhase + cfg.idleFrequency * 0.67 * dt) % TWO_PI
      } else {
        const blendAlpha = 1 - Math.exp(-cfg.stateBlendRate * dt)
        const targetWalk = nextState === PLAYER_ANIM_STATES.WALK ? 1 : 0
        const targetSprint = nextState === PLAYER_ANIM_STATES.SPRINT ? 1 : 0

        this.walkWeight += (targetWalk - this.walkWeight) * blendAlpha
        this.sprintWeight += (targetSprint - this.sprintWeight) * blendAlpha

        const locoSum = clamp(this.walkWeight + this.sprintWeight, 0, 1)
        const sprintRatio = locoSum > 1e-5 ? this.sprintWeight / locoSum : 0

        const isHandlingFurniture =
          motion?.furniture &&
          motion.furniture.mode &&
          motion.furniture.mode !== FURNITURE_ANIM_MODES.NONE
        const strideLength = isHandlingFurniture
          ? 0.92
          : lerp(1.5, 2.2, sprintRatio)
        const distanceStep = actualSpeed * dt
        const strideRate = (distanceStep / strideLength) * TWO_PI
        this.stridePhase = (this.stridePhase + strideRate) % TWO_PI

        // Gently keep idle phases advancing quietly in background so idle resume never pops
        this.idlePhase = (this.idlePhase + cfg.idleFrequency * 0.35 * dt) % TWO_PI
        this._idleWeightPhase =
          (this._idleWeightPhase + cfg.idleFrequency * 0.15 * dt) % TWO_PI
        this._idleScanPhase =
          (this._idleScanPhase + cfg.idleFrequency * 0.1 * dt) % TWO_PI
        this._idleMicroPhase =
          (this._idleMicroPhase + cfg.idleFrequency * 0.22 * dt) % TWO_PI
      }
    }

    const rig = this.playerGroup?.userData?.isDisposed ? null : this.rig
    if (!rig) return

    // --- Procedural Rubble Handling Channels (Anticipation -> Crouch/Reach -> Lift -> Carry -> Lower/Release) ---
    const rubbleInput = motion?.rubble || null
    const nextRubbleMode =
      rubbleInput && typeof rubbleInput.mode === 'string'
        ? rubbleInput.mode
        : RUBBLE_ANIM_MODES.NONE
    const rubbleProgress =
      rubbleInput && Number.isFinite(rubbleInput.progress)
        ? clamp(rubbleInput.progress, 0, 1)
        : 0
    const targetGripWidth =
      rubbleInput && Number.isFinite(rubbleInput.slabHalfX)
        ? clamp(rubbleInput.slabHalfX, 0.22, 0.44)
        : 0.34

    this._rubbleMode = nextRubbleMode
    this._rubbleProgress = rubbleProgress

    let targetBlend = 0
    let targetCrouch = 0
    let targetReach = 0
    let targetCarry = 0
    let targetEffort = 0
    let targetGazeDown = 0
    let targetReleaseOpen = 0

    if (nextRubbleMode === RUBBLE_ANIM_MODES.PICKUP) {
      targetBlend = 1
      const p = rubbleProgress
      if (p < 0.18) {
        // Phase 1: Anticipation & stance settle
        const u = smoothUnitBell(p / 0.18)
        targetCrouch = 0.18 * u
        targetReach = 0.16 * u
        targetCarry = 0
        targetEffort = 0.12 * u
        targetGazeDown = 0.48 * u
      } else if (p < 0.50) {
        // Phase 2: Ergonomic knee/hip bend, forward torso lean & downward arm reach to contact slab
        const u = smoothUnitBell((p - 0.18) / 0.32)
        targetCrouch = lerp(0.18, 1.0, u)
        targetReach = lerp(0.16, 1.0, u)
        targetCarry = 0
        targetEffort = lerp(0.12, 0.72, u)
        targetGazeDown = lerp(0.48, 1.0, u)
      } else if (p < 0.60) {
        // Phase 3: Grip contact & weight transfer brace (slab attaches to hands at p = 0.52)
        const u = (p - 0.50) / 0.10
        targetCrouch = 1.0 - 0.04 * u
        targetReach = 1.0 - 0.08 * u
        targetCarry = 0.12 * smoothUnitBell(u)
        targetEffort = lerp(0.72, 1.0, Math.sin(u * Math.PI * 0.5))
        targetGazeDown = 1.0 - 0.08 * u
      } else {
        // Phase 4: Heavy lift drive & smooth recovery into chest/waist carrying cradle
        const u = smoothUnitBell((p - 0.60) / 0.40)
        targetCrouch = lerp(0.96, 0.06, u)
        targetReach = lerp(0.92, 0.0, u)
        targetCarry = lerp(0.12, 1.0, u)
        targetEffort = lerp(1.0, 0.36, u)
        targetGazeDown = lerp(0.92, 0.14, u)
      }
    } else if (nextRubbleMode === RUBBLE_ANIM_MODES.CARRY) {
      targetBlend = 1
      targetCrouch = 0.06
      targetReach = 0
      targetCarry = 1.0
      targetEffort = 0.36
      targetGazeDown = 0.12
    } else if (nextRubbleMode === RUBBLE_ANIM_MODES.PLACE) {
      targetBlend = 1
      const p = rubbleProgress
      if (p < 0.55) {
        // Phase 1: Controlled bend & forward lowering of heavy slab to floor target
        const u = smoothUnitBell(p / 0.55)
        targetCrouch = lerp(0.06, 0.94, u)
        targetCarry = lerp(1.0, 0.0, u)
        targetReach = lerp(0.0, 0.96, u)
        targetEffort = lerp(0.36, 0.88, Math.sin(u * Math.PI * 0.85))
        targetGazeDown = lerp(0.14, 0.95, u)
      } else {
        // Phase 2: Release hands cleanly off placed slab & rise back to upright stance
        const u = smoothUnitBell((p - 0.55) / 0.45)
        targetCrouch = lerp(0.94, 0.0, u)
        targetCarry = 0
        targetReach = lerp(0.96, 0.0, u)
        targetEffort = lerp(0.65, 0.0, u)
        targetGazeDown = lerp(0.95, 0.0, u)
        targetReleaseOpen = Math.sin(u * Math.PI) * 0.22
        targetBlend = lerp(1.0, 0.0, u)
      }
    }

    const rubbleAlpha = dt > 0 ? 1 - Math.exp(-16.0 * dt) : 1
    this._rubbleBlend += (targetBlend - this._rubbleBlend) * rubbleAlpha
    this._rubbleCrouch += (targetCrouch - this._rubbleCrouch) * rubbleAlpha
    this._rubbleReach += (targetReach - this._rubbleReach) * rubbleAlpha
    this._rubbleCarry += (targetCarry - this._rubbleCarry) * rubbleAlpha
    this._rubbleEffort += (targetEffort - this._rubbleEffort) * rubbleAlpha
    this._rubbleGazeDown += (targetGazeDown - this._rubbleGazeDown) * rubbleAlpha
    this._rubbleGripWidth += (targetGripWidth - this._rubbleGripWidth) * rubbleAlpha
    this._rubbleReleaseOpen += (targetReleaseOpen - this._rubbleReleaseOpen) * rubbleAlpha

    if (nextRubbleMode === RUBBLE_ANIM_MODES.NONE && this._rubbleBlend < 0.002) {
      this._rubbleBlend = 0
      this._rubbleCrouch = 0
      this._rubbleReach = 0
      this._rubbleCarry = 0
      this._rubbleEffort = 0
      this._rubbleGazeDown = 0
      this._rubbleReleaseOpen = 0
    }

    const rBlend = this._rubbleBlend
    const rCrouch = this._rubbleCrouch
    const rReach = this._rubbleReach
    const rCarry = this._rubbleCarry
    const rEffort = this._rubbleEffort
    const rGazeDown = this._rubbleGazeDown
    const rArmWeight = clamp(Math.max(rReach, rCarry, rBlend * 0.85), 0, 1)

    // --- Procedural Rotten Furniture Handling Channels (Approach/Grip -> Push/Drag -> Release) ---
    const furnitureInput = motion?.furniture || null
    const nextFurnitureMode =
      furnitureInput && typeof furnitureInput.mode === 'string'
        ? furnitureInput.mode
        : FURNITURE_ANIM_MODES.NONE
    const furnitureProgress =
      furnitureInput && Number.isFinite(furnitureInput.progress)
        ? clamp(furnitureInput.progress, 0, 1)
        : 0
    const targetFurnPushSign =
      furnitureInput && Number.isFinite(furnitureInput.pushSign)
        ? clamp(furnitureInput.pushSign, -1, 1)
        : 0
    const targetFurnStrafeSign =
      furnitureInput && Number.isFinite(furnitureInput.strafeSign)
        ? clamp(furnitureInput.strafeSign, -1, 1)
        : 0
    const targetFurnHeightNorm =
      furnitureInput && Number.isFinite(furnitureInput.gripHeightNorm)
        ? clamp(furnitureInput.gripHeightNorm, 0, 1)
        : 0
    const targetFurnInputEffort =
      furnitureInput && Number.isFinite(furnitureInput.effort)
        ? clamp(furnitureInput.effort, 0, 1)
        : 0

    this._furnitureMode = nextFurnitureMode
    this._furnitureProgress = furnitureProgress

    let targetFBlend = 0
    let targetFCrouch = 0
    let targetFReach = 0
    let targetFBrace = 0
    let targetFEffort = 0
    let targetFGazeDown = 0
    let targetFReleaseOpen = 0

    if (nextFurnitureMode === FURNITURE_ANIM_MODES.GRIP) {
      targetFBlend = 1
      const p = furnitureProgress
      if (p < 0.22) {
        // Phase 1: Turn & stance widen anticipation
        const u = smoothUnitBell(p / 0.22)
        targetFCrouch = 0.24 * u
        targetFReach = 0.22 * u
        targetFBrace = 0.05 * u
        targetFEffort = 0.18 * u
        targetFGazeDown = 0.52 * u
      } else if (p < 0.56) {
        // Phase 2: Knee bend, forward torso lean & two-handed reach toward shelving frame rails
        const u = smoothUnitBell((p - 0.22) / 0.34)
        targetFCrouch = lerp(0.24, 0.96, u)
        targetFReach = lerp(0.22, 1.0, u)
        targetFBrace = lerp(0.05, 0.48, u)
        targetFEffort = lerp(0.18, 0.65, u)
        targetFGazeDown = lerp(0.52, 0.94, u)
      } else {
        // Phase 3: Hands establish firm contact on frame rails & lock into braced pushing stance
        const u = smoothUnitBell((p - 0.56) / 0.44)
        targetFCrouch = lerp(0.96, lerp(0.9, 0.46, targetFurnHeightNorm), u)
        targetFReach = lerp(1.0, 0.94, u)
        targetFBrace = lerp(0.48, 1.0, u)
        targetFEffort = lerp(0.65, Math.max(0.45, targetFurnInputEffort), u)
        targetFGazeDown = lerp(0.94, lerp(0.74, 0.32, targetFurnHeightNorm), u)
      }
    } else if (nextFurnitureMode === FURNITURE_ANIM_MODES.PUSH_DRAG) {
      targetFBlend = 1
      targetFCrouch = lerp(0.88, 0.44, targetFurnHeightNorm)
      targetFReach = 0.94
      targetFBrace = 1.0
      targetFEffort = Math.max(0.38, targetFurnInputEffort)
      targetFGazeDown = lerp(0.72, 0.3, targetFurnHeightNorm)
    } else if (nextFurnitureMode === FURNITURE_ANIM_MODES.RELEASE) {
      const p = furnitureProgress
      const u = smoothUnitBell(p)
      targetFBlend = 1.0 - u
      targetFCrouch = lerp(0.68, 0.0, u)
      targetFReach = lerp(0.88, 0.0, u)
      targetFBrace = lerp(0.9, 0.0, u)
      targetFEffort = lerp(0.4, 0.0, u)
      targetFGazeDown = lerp(0.55, 0.0, u)
      targetFReleaseOpen = Math.sin(u * Math.PI) * 0.2
    }

    const furnAlpha = dt > 0 ? 1 - Math.exp(-15.0 * dt) : 1
    this._furnitureBlend += (targetFBlend - this._furnitureBlend) * furnAlpha
    this._furnitureCrouch += (targetFCrouch - this._furnitureCrouch) * furnAlpha
    this._furnitureReach += (targetFReach - this._furnitureReach) * furnAlpha
    this._furnitureBrace += (targetFBrace - this._furnitureBrace) * furnAlpha
    this._furniturePushSign += (targetFurnPushSign - this._furniturePushSign) * furnAlpha
    this._furnitureStrafeSign +=
      (targetFurnStrafeSign - this._furnitureStrafeSign) * furnAlpha
    this._furnitureHeightNorm +=
      (targetFurnHeightNorm - this._furnitureHeightNorm) * furnAlpha
    this._furnitureEffort += (targetFEffort - this._furnitureEffort) * furnAlpha
    this._furnitureGazeDown += (targetFGazeDown - this._furnitureGazeDown) * furnAlpha
    this._furnitureReleaseOpen +=
      (targetFReleaseOpen - this._furnitureReleaseOpen) * furnAlpha

    if (
      nextFurnitureMode === FURNITURE_ANIM_MODES.NONE &&
      this._furnitureBlend < 0.002
    ) {
      this._furnitureBlend = 0
      this._furnitureCrouch = 0
      this._furnitureReach = 0
      this._furnitureBrace = 0
      this._furniturePushSign = 0
      this._furnitureStrafeSign = 0
      this._furnitureEffort = 0
      this._furnitureGazeDown = 0
      this._furnitureReleaseOpen = 0
    }

    const fBlend = this._furnitureBlend
    const fCrouch = this._furnitureCrouch
    const fReach = this._furnitureReach
    const fBrace = this._furnitureBrace
    const fPushSign = this._furniturePushSign
    const fStrafeSign = this._furnitureStrafeSign
    const fHeightNorm = this._furnitureHeightNorm
    const fEffort = this._furnitureEffort
    const fGazeDown = this._furnitureGazeDown
    const fArmWeight = clamp(Math.max(fReach, fBrace, fBlend * 0.9), 0, 1)

    const loco = clamp(this.walkWeight + this.sprintWeight, 0, 1)
    const sprintRatio = loco > 1e-5 ? this.sprintWeight / loco : 0
    const idleWeight = 1 - loco

    const leftPhase = this.stridePhase
    const rightPhase = this.stridePhase + Math.PI

    const strideSin = Math.sin(leftPhase)
    const strideCos = Math.cos(leftPhase)
    // Natural hip sweep adds slight 2nd/3rd harmonic asymmetry for longer stance sweep & crisp swing recovery
    const hipSweepWave = 0.9 * (strideSin - 0.11 * Math.sin(3 * leftPhase))
    const doubleBounce = 0.5 * (1 - Math.cos(2 * leftPhase))

    // Continuous multi-frequency idle breathing, weight shift & subtle exploratory gaze
    const idleBreath = Math.sin(this.idlePhase)
    const idleBreathChest =
      0.62 * idleBreath + 0.38 * Math.sin(this.idlePhase - 0.35)
    const idleShift = Math.sin(this._idleWeightPhase + 0.6)
    const idleMicro = Math.sin(this._idleMicroPhase + 1.4)
    const idleHeadScan =
      (Math.sin(this._idleScanPhase) * 0.025 +
        Math.sin(this._idleMicroPhase * 2 + 0.5) * 0.006) *
      idleWeight
    const idleHeadTilt = (idleShift * 0.012 + idleMicro * 0.004) * idleWeight

    const pelvis = rig.pelvisPivot
    const spine = rig.spinePivot || rig.upperBodyPivot
    const neck = rig.neckPivot
    const head = rig.headPivot

    const leftShoulder = rig.leftShoulderPivot || rig.leftArmPivot
    const leftElbow = rig.leftElbowPivot
    const leftWrist = rig.leftWristPivot
    const rightShoulder = rig.rightShoulderPivot || rig.rightArmPivot
    const rightElbow = rig.rightElbowPivot
    const rightWrist = rig.rightWristPivot

    const leftHip = rig.leftHipPivot || rig.leftLegPivot
    const leftKnee = rig.leftKneePivot
    const leftAnkle = rig.leftAnklePivot
    const rightHip = rig.rightHipPivot || rig.rightLegPivot
    const rightKnee = rig.rightKneePivot
    const rightAnkle = rig.rightAnklePivot

    const restPose = rig.restPose
    const restPelvisY = Number.isFinite(restPose?.pelvisY)
      ? restPose.pelvisY
      : DEFAULT_PELVIS_Y
    const restSpineY = Number.isFinite(restPose?.spineY)
      ? restPose.spineY
      : Number.isFinite(restPose?.upperBodyY)
        ? restPose.upperBodyY
        : 0.05
    const restLeftLegY = Number.isFinite(restPose?.leftLegY)
      ? restPose.leftLegY
      : 0
    const restRightLegY = Number.isFinite(restPose?.rightLegY)
      ? restPose.rightLegY
      : 0

    // --- Pelvis & Thoracic Spine Figure-8 Kinematics ---
    const pelvisShiftX =
      (strideCos * lerp(0.016, 0.011, sprintRatio) * loco +
        (idleShift * 0.009 + 0.003) * idleWeight) ||
      0
    const pelvisX = (cfg.sprintPelvisLean * this.sprintWeight) || 0
    const pelvisYawAmp = lerp(cfg.walkPelvisTwist, cfg.sprintPelvisTwist, sprintRatio)
    const pelvisRollAmp = lerp(cfg.walkPelvisRoll, cfg.sprintPelvisRoll, sprintRatio)
    const pelvisY =
      (-strideSin * pelvisYawAmp * loco +
        idleShift * cfg.idlePelvisTwist * idleWeight) ||
      0
    // Slight phase lag on pelvic drop gives authentic hip hike/drop on weight acceptance
    const pelvisRollWave = Math.cos(leftPhase - 0.18)
    const pelvisZ =
      (pelvisRollWave * pelvisRollAmp * loco +
        (idleShift + 0.15) * cfg.idlePelvisRoll * idleWeight) ||
      0

    // Thoracic spine counter-rotates with ~0.16 rad natural phase lag & soft step settle
    const spineCounterLag = Math.sin(leftPhase - 0.16)
    const spineLean =
      ((lerp(cfg.walkTorsoLean, cfg.sprintTorsoLean, sprintRatio) -
        doubleBounce * lerp(0.012, 0.022, sprintRatio)) *
        loco +
        (-0.01 + idleBreathChest * cfg.idleTorsoPitch + idleMicro * 0.003) *
          idleWeight) ||
      0
    const spineTwist =
      (spineCounterLag *
        lerp(cfg.walkTorsoTwist, cfg.sprintTorsoTwist, sprintRatio) *
        loco -
        (idleShift * 0.01 - idleMicro * 0.003) * idleWeight) ||
      0
    const spineRoll =
      (-pelvisRollWave *
        lerp(cfg.walkTorsoRoll, cfg.sprintTorsoRoll, sprintRatio) *
        loco -
        (idleShift + 0.12) * 0.013 * idleWeight) ||
      0

    // --- Leg Kinematics (Hip -> Knee -> Ankle with Loading Yield & Foot Roll) ---
    const legAmp = lerp(cfg.walkLegSwing, cfg.sprintLegSwing, sprintRatio) * loco
    const baseKnee = lerp(cfg.walkKneeBaseBend, cfg.sprintKneeBaseBend, sprintRatio)
    const swingKnee = lerp(cfg.walkKneeSwingBend, cfg.sprintKneeSwingBend, sprintRatio)
    const stanceKnee = lerp(cfg.walkKneeStanceBend, cfg.sprintKneeStanceBend, sprintRatio)
    const heelStrikePitch = lerp(
      cfg.walkHeelStrikePitch,
      cfg.sprintHeelStrikePitch,
      sprintRatio
    )
    const pushOffPitch = lerp(cfg.walkPushOffPitch, cfg.sprintPushOffPitch, sprintRatio)
    const swingAnkleDorsi = lerp(0.19, 0.25, sprintRatio)

    // Subtle idle weight-shift asymmetry between left and right stance knees
    const leftIdleHipX = 0.022 + idleShift * 0.008
    const rightIdleHipX = 0.016 - idleShift * 0.008
    const leftIdleKneeX = -cfg.idleKneeBend * (1.08 + idleShift * 0.26)
    const rightIdleKneeX = -cfg.idleKneeBend * (0.92 - idleShift * 0.26)
    const leftIdleAnkleX = -(leftIdleHipX + leftIdleKneeX)
    const rightIdleAnkleX = -(rightIdleHipX + rightIdleKneeX)

    // Left Leg
    const leftS = strideSin
    const leftC = strideCos
    const leftSwingBell = smoothUnitBell(Math.max(0, Math.cos(leftPhase - 0.22)))
    // Loading response peaks just after heel strike (phase ~ pi - 0.4) to cushion impact
    const leftLoadingYield = smoothUnitBell(Math.max(0, Math.sin(leftPhase - 1.95)))
    const leftStanceBell = smoothUnitBell(Math.max(0, -leftC))
    const leftContact = clamp(0.78 - 0.78 * leftC, 0, 1)

    const leftHipX =
      (hipSweepWave * legAmp +
        cfg.sprintHipDrive * sprintRatio * leftSwingBell * loco +
        leftIdleHipX * idleWeight) ||
      0
    const leftLocoKneeX = -(
      baseKnee +
      swingKnee * leftSwingBell +
      stanceKnee * (0.65 * leftStanceBell + 0.5 * leftLoadingYield)
    )
    const leftKneeX =
      clamp(lerp(leftIdleKneeX, leftLocoKneeX, loco), -1.75, 0) || 0

    // Heel strike -> rapid foot-flat -> crisp late-stance toe push-off
    const leftPushCurve = Math.pow(Math.max(0, -leftS), 0.85)
    const leftTargetWorldPitch =
      leftS >= 0
        ? heelStrikePitch * leftS * (1 - 0.35 * leftLoadingYield)
        : pushOffPitch * leftPushCurve
    const leftStanceAnkleX = leftTargetWorldPitch - (pelvisX + leftHipX + leftKneeX)
    const leftLocoAnkleX = clamp(
      lerp(swingAnkleDorsi, leftStanceAnkleX, leftContact),
      -0.64,
      0.52
    )
    const leftAnkleX = lerp(leftIdleAnkleX, leftLocoAnkleX, loco) || 0

    // Right Leg
    const rightS = -strideSin
    const rightC = -strideCos
    const rightSwingBell = smoothUnitBell(Math.max(0, Math.cos(rightPhase - 0.22)))
    const rightLoadingYield = smoothUnitBell(Math.max(0, Math.sin(rightPhase - 1.95)))
    const rightStanceBell = smoothUnitBell(Math.max(0, -rightC))
    const rightContact = clamp(0.78 - 0.78 * rightC, 0, 1)

    const rightHipX =
      (-hipSweepWave * legAmp +
        cfg.sprintHipDrive * sprintRatio * rightSwingBell * loco +
        rightIdleHipX * idleWeight) ||
      0
    const rightLocoKneeX = -(
      baseKnee +
      swingKnee * rightSwingBell +
      stanceKnee * (0.65 * rightStanceBell + 0.5 * rightLoadingYield)
    )
    const rightKneeX =
      clamp(lerp(rightIdleKneeX, rightLocoKneeX, loco), -1.75, 0) || 0

    const rightPushCurve = Math.pow(Math.max(0, -rightS), 0.85)
    const rightTargetWorldPitch =
      rightS >= 0
        ? heelStrikePitch * rightS * (1 - 0.35 * rightLoadingYield)
        : pushOffPitch * rightPushCurve
    const rightStanceAnkleX =
      rightTargetWorldPitch - (pelvisX + rightHipX + rightKneeX)
    const rightLocoAnkleX = clamp(
      lerp(swingAnkleDorsi, rightStanceAnkleX, rightContact),
      -0.64,
      0.52
    )
    const rightAnkleX = lerp(rightIdleAnkleX, rightLocoAnkleX, loco) || 0

    // --- Rubble Handling Lower-Body Ergonomic Crouch & Weight Shift ---
    // Keeps feet firmly planted on floor via exact computeBootMinRelY analytical grounding.
    let effPelvisX = pelvisX
    let effPelvisY = pelvisY
    let effPelvisZ = pelvisZ
    let effPelvisShiftX = pelvisShiftX
    let effPelvisShiftZ = 0
    let effLeftHipX = leftHipX
    let effRightHipX = rightHipX
    let effLeftKneeX = leftKneeX
    let effRightKneeX = rightKneeX
    let effLeftAnkleX = leftAnkleX
    let effRightAnkleX = rightAnkleX

    if (rBlend > 1e-4) {
      // Heavy-carry locomotion damps pelvic twist slightly for grounded load stability
      const carryLocDamp = 1 - 0.45 * rCarry
      effPelvisY *= carryLocDamp

      // Deep ergonomic lift crouch: hips flex forward, knees flex back, ankles dorsiflex flat
      const crouchHipL = 0.88 * rCrouch
      const crouchHipR = 0.78 * rCrouch // Subtle athletic stance asymmetry for realism
      const crouchKneeL = -1.52 * rCrouch
      const crouchKneeR = -1.38 * rCrouch
      const crouchPelvisPitch = -0.15 * rCrouch + 0.03 * rCarry
      const crouchWeightShiftX = -0.024 * rCrouch * (0.6 + 0.4 * rEffort)

      const crouchOverride = clamp(rCrouch * 1.15, 0, 1)
      effPelvisX = lerp(effPelvisX, crouchPelvisPitch, clamp(Math.max(crouchOverride, rCarry * 0.6), 0, 1))
      effPelvisZ = lerp(effPelvisZ, -0.032 * rCrouch, crouchOverride)
      effPelvisShiftX = lerp(effPelvisShiftX, crouchWeightShiftX, crouchOverride)
      effPelvisShiftZ = 0.065 * rCrouch // Shift hips slightly back to counterbalance forward torso lean

      // Blend legs between locomotion gait and deep grounded crouch (while carry retains full walk gait!)
      const legCrouchWeight = clamp(rCrouch * (1 - 0.55 * loco * rCarry), 0, 1)
      effLeftHipX = lerp(effLeftHipX, crouchHipL, legCrouchWeight)
      effRightHipX = lerp(effRightHipX, crouchHipR, legCrouchWeight)
      effLeftKneeX = clamp(lerp(effLeftKneeX, crouchKneeL, legCrouchWeight), -1.72, 0)
      effRightKneeX = clamp(lerp(effRightKneeX, crouchKneeR, legCrouchWeight), -1.72, 0)

      // Analytical flat-sole ankle dorsiflexion during crouch so boots stay flush on floor
      const crouchAnkleL = clamp(-(effPelvisX + effLeftHipX + effLeftKneeX), -0.55, 0.78)
      const crouchAnkleR = clamp(-(effPelvisX + effRightHipX + effRightKneeX), -0.55, 0.78)
      effLeftAnkleX = lerp(effLeftAnkleX, crouchAnkleL, legCrouchWeight)
      effRightAnkleX = lerp(effRightAnkleX, crouchAnkleR, legCrouchWeight)
    }

    // --- Rotten Furniture Handling Lower-Body Crouch, Driving Leg Stride & Weight Transfer ---
    if (fBlend > 1e-4) {
      // Staggered athletic pushing stance when stationary, blending seamlessly into
      // low, high-effort driving leg steps with visible lateral pelvic weight transfer when moving.
      const staticCrouchWeight = clamp(fCrouch * (1 - 0.52 * loco * fBrace), 0, 1)
      const moveCrouchBias = lerp(0.58, 0.26, fHeightNorm) * fCrouch * loco * fBrace

      const furnStaticHipL = lerp(0.96, 0.54, fHeightNorm) * fCrouch
      const furnStaticHipR = lerp(0.88, 0.48, fHeightNorm) * fCrouch
      const furnStaticKneeL = -lerp(1.62, 0.96, fHeightNorm) * fCrouch
      const furnStaticKneeR = -lerp(1.5, 0.88, fHeightNorm) * fCrouch

      const driveSign = clamp(fPushSign * 2.5, -1, 1)
      const driveLeftHip =
        leftHipX * (0.35 + 0.8 * Math.abs(driveSign)) * (driveSign >= 0 ? 1 : -1) +
        moveCrouchBias * 1.18
      const driveRightHip =
        rightHipX * (0.35 + 0.8 * Math.abs(driveSign)) * (driveSign >= 0 ? 1 : -1) +
        moveCrouchBias * 1.18
      const driveLeftKnee = clamp(
        leftKneeX * 0.92 - moveCrouchBias * 1.95,
        -1.72,
        -0.18
      )
      const driveRightKnee = clamp(
        rightKneeX * 0.92 - moveCrouchBias * 1.95,
        -1.72,
        -0.18
      )

      const locoLeftHip = lerp(effLeftHipX, driveLeftHip, fBrace * loco)
      const locoRightHip = lerp(effRightHipX, driveRightHip, fBrace * loco)
      const locoLeftKnee = lerp(effLeftKneeX, driveLeftKnee, fBrace * loco)
      const locoRightKnee = lerp(effRightKneeX, driveRightKnee, fBrace * loco)

      effLeftHipX = lerp(locoLeftHip, furnStaticHipL, staticCrouchWeight)
      effRightHipX = lerp(locoRightHip, furnStaticHipR, staticCrouchWeight)
      effLeftKneeX = clamp(
        lerp(locoLeftKnee, furnStaticKneeL, staticCrouchWeight),
        -1.72,
        0
      )
      effRightKneeX = clamp(
        lerp(locoRightKnee, furnStaticKneeR, staticCrouchWeight),
        -1.72,
        0
      )

      const furnPelvisPitch =
        (-0.22 * fCrouch + 0.06 * fHeightNorm * fCrouch - 0.05 * Math.max(0, fPushSign) * fBrace + 0.08 * Math.max(0, -fPushSign) * fBrace) *
        fBlend
      effPelvisX = lerp(effPelvisX, furnPelvisPitch, clamp(fBlend * 1.1, 0, 1))
      effPelvisY =
        effPelvisY * (1 - 0.35 * fBrace) - 0.06 * fStrafeSign * fBrace
      effPelvisZ =
        lerp(
          effPelvisZ,
          pelvisRollWave * 0.042 * loco * fBrace - 0.025 * fStrafeSign * fBrace,
          fBlend
        )
      effPelvisShiftX =
        lerp(
          effPelvisShiftX,
          strideCos * 0.026 * loco * fBrace + 0.024 * fStrafeSign * fBrace,
          fBlend
        )
      effPelvisShiftZ =
        lerp(
          effPelvisShiftZ,
          (0.068 - 0.018 * fPushSign) * fCrouch,
          fBlend
        )

      // Analytical flat-sole ankle compensation so boots remain firmly grounded on floor
      const furnFlatAnkleL = clamp(
        -(effPelvisX + effLeftHipX + effLeftKneeX),
        -0.58,
        0.78
      )
      const furnFlatAnkleR = clamp(
        -(effPelvisX + effRightHipX + effRightKneeX),
        -0.58,
        0.78
      )
      const ankleBlend = clamp(Math.max(staticCrouchWeight, 0.55 * fBlend), 0, 1)
      effLeftAnkleX = lerp(effLeftAnkleX, furnFlatAnkleL, ankleBlend)
      effRightAnkleX = lerp(effRightAnkleX, furnFlatAnkleR, ankleBlend)
    }

    // --- Grounding & Pelvis Height ---
    const leftBootMinY = computeBootMinRelY(
      effPelvisX,
      effPelvisZ,
      effLeftHipX,
      effLeftKneeX,
      effLeftAnkleX,
      -1
    )
    const rightBootMinY = computeBootMinRelY(
      effPelvisX,
      effPelvisZ,
      effRightHipX,
      effRightKneeX,
      effRightAnkleX,
      1
    )
    const minBootRelY = leftBootMinY < rightBootMinY ? leftBootMinY : rightBootMinY
    const groundedPelvisY = restPelvisY - (DEFAULT_PELVIS_Y + minBootRelY)
    const sprintFlightLift =
      cfg.sprintFlightLift *
      doubleBounce *
      this.sprintWeight *
      (1 - Math.max(rBlend, fBlend))

    if (pelvis) {
      if (pelvis.position) {
        pelvis.position.x = effPelvisShiftX
        pelvis.position.y = groundedPelvisY + sprintFlightLift
        pelvis.position.z = effPelvisShiftZ
      }
      pelvis.rotation.x = effPelvisX
      pelvis.rotation.y = effPelvisY
      pelvis.rotation.z = effPelvisZ
    }

    const activeCrouch = Math.max(rCrouch, fCrouch)
    const hipTurnout = lerp(0.036, 0.02, sprintRatio) + 0.055 * activeCrouch
    const ankleTurnout = lerp(0.038, 0.022, sprintRatio) + 0.04 * activeCrouch

    if (leftHip) {
      leftHip.rotation.x = effLeftHipX
      leftHip.rotation.y = hipTurnout + idleShift * 0.012 * idleWeight
      leftHip.rotation.z = 0
      if (leftHip.position) {
        leftHip.position.y = pelvis
          ? restLeftLegY
          : restLeftLegY + Math.max(0, strideSin) * 0.055 * loco
      }
    }
    if (leftKnee) {
      leftKnee.rotation.x = effLeftKneeX
    }
    if (leftAnkle) {
      leftAnkle.rotation.x = effLeftAnkleX
      leftAnkle.rotation.y = ankleTurnout
      leftAnkle.rotation.z = 0
    }

    if (rightHip) {
      rightHip.rotation.x = effRightHipX
      rightHip.rotation.y = -hipTurnout - idleShift * 0.012 * idleWeight
      rightHip.rotation.z = 0
      if (rightHip.position) {
        rightHip.position.y = pelvis
          ? restRightLegY
          : restRightLegY + Math.max(0, -strideSin) * 0.055 * loco
      }
    }
    if (rightKnee) {
      rightKnee.rotation.x = effRightKneeX
    }
    if (rightAnkle) {
      rightAnkle.rotation.x = effRightAnkleX
      rightAnkle.rotation.y = -ankleTurnout
      rightAnkle.rotation.z = 0
    }

    // --- Arm Kinematics (Shoulder -> Elbow -> Wrist with Lag & Subtle Asymmetry) ---
    const armAmp = lerp(cfg.walkArmSwing, cfg.sprintArmSwing, sprintRatio) * loco
    const armForwardBias = cfg.sprintArmBendPitch * this.sprintWeight
    const shoulderAbduct = 0.044 * (1 - this.sprintWeight) + 0.084 * this.sprintWeight

    const locoElbowBase = lerp(
      cfg.walkElbowBaseBend,
      cfg.sprintElbowBaseBend,
      sprintRatio
    )
    const locoElbowSwing = lerp(
      cfg.walkElbowSwingBend,
      cfg.sprintElbowSwingBend,
      sprintRatio
    )
    const elbowInwardYaw = 0.045 * this.walkWeight + 0.145 * this.sprintWeight
    const wristInwardRoll = 0.052 + 0.018 * this.sprintWeight

    const leftArmSwing = -strideSin
    const rightArmSwing = strideSin
    const leftArmLag = -Math.sin(leftPhase - 0.22)
    const rightArmLag = Math.sin(leftPhase - 0.22)
    const leftWristLag = -Math.sin(leftPhase - 0.38)
    const rightWristLag = Math.sin(leftPhase - 0.38)

    // --- Two-Handed Rubble Handling Arm Targets (Reach/Grip <-> Heavy Carry Cradle) ---
    // Blend cleanly over locomotion arm swing so hands grip slab sides & stay rock-steady while walking.
    const gripWidthFactor = clamp((this._rubbleGripWidth - 0.22) / 0.22, 0, 1)
    const carryWalkLoadBob = doubleBounce * 0.028 * loco * rCarry
    const carryIdleBreath = idleBreathChest * 0.014 * idleWeight * rCarry
    const reachVsCarryDenom = rReach + rCarry
    const reachRatio = reachVsCarryDenom > 1e-4 ? rReach / reachVsCarryDenom : 0

    const rubbleShoulderX = lerp(
      0.46 + carryWalkLoadBob + carryIdleBreath,
      0.94 + 0.06 * rEffort,
      reachRatio
    )
    const rubbleShoulderAbduct =
      lerp(0.14 + gripWidthFactor * 0.14, 0.2 + gripWidthFactor * 0.18, reachRatio) +
      this._rubbleReleaseOpen
    const rubbleShoulderYaw = lerp(0.14, 0.18, reachRatio)
    const rubbleElbowX = lerp(
      1.24 - carryWalkLoadBob * 0.6,
      0.44 + 0.08 * rEffort,
      reachRatio
    )
    const rubbleElbowYaw = lerp(
      0.24 - gripWidthFactor * 0.08,
      0.16 - gripWidthFactor * 0.05,
      reachRatio
    )
    const rubbleWristX = lerp(0.18, -0.22, reachRatio)
    const rubbleWristZ = lerp(0.32, 0.26, reachRatio)

    // --- Two-Handed Rotten Furniture Grip & Push/Drag Arm Targets ---
    const isFirstPersonView = Boolean(motion?.isFirstPerson)
    const furnStepPulse = doubleBounce * 0.036 * loco * fBrace
    const furnBreathPulse = idleBreathChest * 0.012 * idleWeight * fBrace
    const furnShoulderX =
      lerp(1.24, 1.34, fHeightNorm) +
      0.06 * fPushSign * fBrace +
      0.04 * fEffort +
      furnStepPulse +
      furnBreathPulse +
      (isFirstPersonView ? 0.06 * fBlend : 0)
    const furnShoulderAbduct =
      0.11 + 0.03 * fBrace + this._furnitureReleaseOpen
    const furnShoulderYaw = 0.08 + 0.04 * fBrace
    const furnElbowX =
      lerp(0.28, 0.44, fBrace) -
      0.07 * Math.max(0, fPushSign) * fBrace +
      0.09 * Math.max(0, -fPushSign) * fBrace +
      furnStepPulse * 0.7
    const furnElbowYaw = 0.14
    const furnWristX = -0.4 - 0.08 * fBrace
    const furnWristZ = 0.12

    const restLeftShoulderY = Number.isFinite(restPose?.leftShoulderY)
      ? restPose.leftShoulderY
      : 0.36
    const restRightShoulderY = Number.isFinite(restPose?.rightShoulderY)
      ? restPose.rightShoulderY
      : 0.36
    const fpArmLiftY = isFirstPersonView ? 0.02 * fBlend : 0
    const fpArmForwardZ = isFirstPersonView ? -0.1 * fBlend : 0

    if (leftShoulder) {
      if (leftShoulder.position) {
        leftShoulder.position.y = restLeftShoulderY + fpArmLiftY
        leftShoulder.position.z = fpArmForwardZ
      }
      const baseLX =
        (leftArmSwing * armAmp * 1.02 +
          armForwardBias +
          (idleBreathChest * cfg.idleArmSway + idleMicro * 0.005) * idleWeight) ||
        0
      const baseLY =
        ((-Math.max(0, leftArmSwing) * (0.045 + 0.065 * sprintRatio) +
          spineTwist * 0.18) *
          loco) ||
        0
      const baseLZ =
        (-(
          shoulderAbduct +
          idleBreathChest * 0.006 * idleWeight +
          doubleBounce * 0.008 * loco
        )) || 0

      const rubLX = lerp(baseLX, rubbleShoulderX + 0.015 * rEffort, rArmWeight) || 0
      const rubLY = lerp(baseLY, -rubbleShoulderYaw, rArmWeight) || 0
      const rubLZ = lerp(baseLZ, -rubbleShoulderAbduct, rArmWeight) || 0

      leftShoulder.rotation.x =
        lerp(rubLX, furnShoulderX - 0.03 * fStrafeSign, fArmWeight) || 0
      leftShoulder.rotation.y =
        lerp(rubLY, -furnShoulderYaw - 0.05 * fStrafeSign, fArmWeight) || 0
      leftShoulder.rotation.z =
        lerp(rubLZ, -furnShoulderAbduct, fArmWeight) || 0
    }
    if (leftElbow) {
      const leftIdleElbow = cfg.idleElbowBend + 0.024 + idleBreathChest * 0.017
      const leftLocoElbow = clamp(
        locoElbowBase + locoElbowSwing * leftArmLag,
        0.12,
        1.75
      )
      const baseLElbowX = lerp(leftIdleElbow, leftLocoElbow, loco) || 0
      const rubLElbowX = lerp(baseLElbowX, rubbleElbowX, rArmWeight) || 0
      const rubLElbowY = lerp(-elbowInwardYaw, -rubbleElbowYaw, rArmWeight) || 0
      leftElbow.rotation.x = lerp(rubLElbowX, furnElbowX, fArmWeight) || 0
      leftElbow.rotation.y = lerp(rubLElbowY, -furnElbowYaw, fArmWeight) || 0
    }
    if (leftWrist) {
      const leftIdleWrist = -0.044 + idleBreathChest * 0.015
      const leftLocoWrist = lerp(
        -0.038 - leftWristLag * 0.095,
        0.042 - leftWristLag * 0.06,
        sprintRatio
      )
      const baseLWristX = lerp(leftIdleWrist, leftLocoWrist, loco) || 0
      const baseLWristY = (-leftWristLag * 0.035 * loco) || 0
      const baseLWristZ = (wristInwardRoll + idleMicro * 0.008 * idleWeight) || 0
      const rubLWristX = lerp(baseLWristX, rubbleWristX, rArmWeight) || 0
      const rubLWristY = lerp(baseLWristY, -0.08, rArmWeight) || 0
      const rubLWristZ = lerp(baseLWristZ, rubbleWristZ, rArmWeight) || 0
      leftWrist.rotation.x = lerp(rubLWristX, furnWristX, fArmWeight) || 0
      leftWrist.rotation.y = lerp(rubLWristY, -0.06, fArmWeight) || 0
      leftWrist.rotation.z = lerp(rubLWristZ, furnWristZ, fArmWeight) || 0
    }

    if (rightShoulder) {
      if (rightShoulder.position) {
        rightShoulder.position.y = restRightShoulderY + fpArmLiftY
        rightShoulder.position.z = fpArmForwardZ
      }
      const baseRX =
        (rightArmSwing * armAmp * 0.97 +
          armForwardBias -
          (idleBreathChest * (cfg.idleArmSway * 0.9) - idleMicro * 0.004) *
            idleWeight) ||
        0
      const baseRY =
        ((Math.max(0, rightArmSwing) * (0.045 + 0.065 * sprintRatio) +
          spineTwist * 0.18) *
          loco) ||
        0
      const baseRZ =
        (shoulderAbduct +
          idleBreathChest * 0.006 * idleWeight +
          doubleBounce * 0.008 * loco) ||
        0

      const rubRX = lerp(baseRX, rubbleShoulderX - 0.012 * rEffort, rArmWeight) || 0
      const rubRY = lerp(baseRY, rubbleShoulderYaw, rArmWeight) || 0
      const rubRZ = lerp(baseRZ, rubbleShoulderAbduct, rArmWeight) || 0

      rightShoulder.rotation.x =
        lerp(rubRX, furnShoulderX + 0.03 * fStrafeSign, fArmWeight) || 0
      rightShoulder.rotation.y =
        lerp(rubRY, furnShoulderYaw - 0.05 * fStrafeSign, fArmWeight) || 0
      rightShoulder.rotation.z =
        lerp(rubRZ, furnShoulderAbduct, fArmWeight) || 0
    }
    if (rightElbow) {
      const rightIdleElbow = cfg.idleElbowBend - 0.016 - idleBreathChest * 0.013
      const rightLocoElbow = clamp(
        locoElbowBase + locoElbowSwing * rightArmLag,
        0.12,
        1.75
      )
      const baseRElbowX = lerp(rightIdleElbow, rightLocoElbow, loco) || 0
      const rubRElbowX = lerp(baseRElbowX, rubbleElbowX, rArmWeight) || 0
      const rubRElbowY = lerp(elbowInwardYaw, rubbleElbowYaw, rArmWeight) || 0
      rightElbow.rotation.x = lerp(rubRElbowX, furnElbowX, fArmWeight) || 0
      rightElbow.rotation.y = lerp(rubRElbowY, furnElbowYaw, fArmWeight) || 0
    }
    if (rightWrist) {
      const rightIdleWrist = -0.036 - idleBreathChest * 0.013
      const rightLocoWrist = lerp(
        -0.038 - rightWristLag * 0.095,
        0.042 - rightWristLag * 0.06,
        sprintRatio
      )
      const baseRWristX = lerp(rightIdleWrist, rightLocoWrist, loco) || 0
      const baseRWristY = (rightWristLag * 0.035 * loco) || 0
      const baseRWristZ = (-wristInwardRoll + idleMicro * 0.006 * idleWeight) || 0
      const rubRWristX = lerp(baseRWristX, rubbleWristX, rArmWeight) || 0
      const rubRWristY = lerp(baseRWristY, 0.08, rArmWeight) || 0
      const rubRWristZ = lerp(baseRWristZ, -rubbleWristZ, rArmWeight) || 0
      rightWrist.rotation.x = lerp(rubRWristX, furnWristX, fArmWeight) || 0
      rightWrist.rotation.y = lerp(rubRWristY, 0.06, fArmWeight) || 0
      rightWrist.rotation.z = lerp(rubRWristZ, -furnWristZ, fArmWeight) || 0
    }

    // --- Spine / Upper Body & Head Stabilization (with Heavy-Load Counterbalance & Target Gaze) ---
    let effSpineLean = spineLean
    let effSpineTwist = spineTwist
    let effSpineRoll = spineRoll
    if (rBlend > 1e-4) {
      // Crouch forward torso lean + slight backward counterbalance while carrying heavy concrete
      const rubbleSpineLean =
        -0.46 * rCrouch + 0.055 * rCarry - 0.04 * rEffort * rCrouch
      effSpineLean = lerp(
        effSpineLean,
        rubbleSpineLean,
        clamp(Math.max(rCrouch * 1.15, rCarry * 0.85), 0, 1)
      )
      // Damp torso twist while carrying so arms/slab stay steady during walking
      effSpineTwist *= 1 - 0.62 * rCarry
      effSpineRoll = lerp(effSpineRoll, 0.025 * rCrouch, rCrouch)
    }
    if (fBlend > 1e-4) {
      // Strong forward body lean when gripping & pushing heavy shelving (or athletic brace when pulling)
      const furnSpineLean =
        lerp(-0.68, -0.34, fHeightNorm) * fCrouch -
        0.08 * Math.max(0, fPushSign) * fBrace +
        0.12 * Math.max(0, -fPushSign) * fBrace -
        0.03 * fEffort
      effSpineLean = lerp(
        effSpineLean,
        furnSpineLean,
        clamp(Math.max(fCrouch * 1.15, fBrace * 0.94), 0, 1)
      )
      effSpineTwist =
        effSpineTwist * (1 - 0.55 * fBrace) - 0.11 * fStrafeSign * fBrace
      effSpineRoll = lerp(
        effSpineRoll,
        -0.055 * fStrafeSign * fBrace + 0.018 * strideCos * loco * fBrace,
        fBlend
      )
    }

    if (spine) {
      if (spine.position) {
        if (pelvis) {
          spine.position.y =
            restSpineY + idleBreathChest * cfg.idleChestBreathLift * idleWeight
        } else {
          const bobAmp =
            lerp(cfg.walkBobAmplitude, cfg.sprintBobAmplitude, sprintRatio) * loco
          spine.position.y =
            restSpineY +
            doubleBounce * bobAmp +
            idleBreathChest * cfg.idleBobAmplitude * idleWeight
        }
      }
      spine.rotation.x = effSpineLean
      spine.rotation.y = effSpineTwist
      spine.rotation.z = effSpineRoll
    }

    const totalLean = effPelvisX + effSpineLean
    const totalYaw = effPelvisY + effSpineTwist
    const totalRoll = effPelvisZ + effSpineRoll
    const stepNod = doubleBounce * lerp(0.008, 0.012, sprintRatio) * loco
    const activeGazeDown = Math.max(rGazeDown, fGazeDown)
    const activeBlend = Math.max(rBlend, fBlend)
    const gazeDownNeck = -0.18 * activeGazeDown
    const gazeDownHead = -0.26 * activeGazeDown

    if (neck) {
      neck.rotation.x =
        (-totalLean * 0.42 -
          idleBreathChest * 0.008 * idleWeight +
          stepNod * 0.4 +
          gazeDownNeck) ||
        0
      neck.rotation.y = (-totalYaw * 0.46) || 0
      neck.rotation.z = (-totalRoll * 0.46) || 0

      if (head) {
        head.rotation.x =
          (-totalLean * (cfg.headCounterPitchFactor * 0.85) +
            idleBreathChest * 0.006 * idleWeight +
            stepNod * 0.6 +
            gazeDownHead) ||
          0
        head.rotation.y =
          (-totalYaw * 0.46 + idleHeadScan * (1 - activeBlend * 0.8)) || 0
        head.rotation.z =
          (-totalRoll * 0.46 + idleHeadTilt * (1 - activeBlend * 0.8)) || 0
      }
    } else if (head) {
      head.rotation.x =
        (-totalLean * cfg.headCounterPitchFactor +
          idleBreathChest * 0.006 * idleWeight +
          stepNod +
          gazeDownHead) ||
        0
      head.rotation.y =
        (-totalYaw * 0.46 + idleHeadScan * (1 - activeBlend * 0.8)) || 0
      head.rotation.z = (-totalRoll * 0.46) || 0
    }
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.reset()
    this.rig = null
    this.playerGroup = null
    return true
  }
}
