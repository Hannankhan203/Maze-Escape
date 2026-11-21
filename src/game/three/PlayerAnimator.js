export const PLAYER_ANIM_STATES = {
  IDLE: 'idle',
  WALK: 'walk',
  SPRINT: 'sprint',
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

    resetPivotRotation(leftShoulder)
    if (rig.leftArmPivot && rig.leftArmPivot !== leftShoulder) {
      resetPivotRotation(rig.leftArmPivot)
    }
    resetPivotRotation(rig.leftElbowPivot)
    resetPivotRotation(rig.leftWristPivot)

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

        const strideLength = lerp(1.5, 2.2, sprintRatio)
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

    // --- Grounding & Pelvis Height ---
    const leftBootMinY = computeBootMinRelY(
      pelvisX,
      pelvisZ,
      leftHipX,
      leftKneeX,
      leftAnkleX,
      -1
    )
    const rightBootMinY = computeBootMinRelY(
      pelvisX,
      pelvisZ,
      rightHipX,
      rightKneeX,
      rightAnkleX,
      1
    )
    const minBootRelY = leftBootMinY < rightBootMinY ? leftBootMinY : rightBootMinY
    const groundedPelvisY = restPelvisY - (DEFAULT_PELVIS_Y + minBootRelY)
    const sprintFlightLift =
      cfg.sprintFlightLift * doubleBounce * this.sprintWeight

    if (pelvis) {
      if (pelvis.position) {
        pelvis.position.x = pelvisShiftX
        pelvis.position.y = groundedPelvisY + sprintFlightLift
      }
      pelvis.rotation.x = pelvisX
      pelvis.rotation.y = pelvisY
      pelvis.rotation.z = pelvisZ
    }

    const hipTurnout = lerp(0.036, 0.02, sprintRatio)
    const ankleTurnout = lerp(0.038, 0.022, sprintRatio)

    if (leftHip) {
      leftHip.rotation.x = leftHipX
      leftHip.rotation.y = hipTurnout + idleShift * 0.012 * idleWeight
      if (leftHip.position) {
        leftHip.position.y = pelvis
          ? restLeftLegY
          : restLeftLegY + Math.max(0, strideSin) * 0.055 * loco
      }
    }
    if (leftKnee) {
      leftKnee.rotation.x = leftKneeX
    }
    if (leftAnkle) {
      leftAnkle.rotation.x = leftAnkleX
      leftAnkle.rotation.y = ankleTurnout
    }

    if (rightHip) {
      rightHip.rotation.x = rightHipX
      rightHip.rotation.y = -hipTurnout - idleShift * 0.012 * idleWeight
      if (rightHip.position) {
        rightHip.position.y = pelvis
          ? restRightLegY
          : restRightLegY + Math.max(0, -strideSin) * 0.055 * loco
      }
    }
    if (rightKnee) {
      rightKnee.rotation.x = rightKneeX
    }
    if (rightAnkle) {
      rightAnkle.rotation.x = rightAnkleX
      rightAnkle.rotation.y = -ankleTurnout
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

    if (leftShoulder) {
      leftShoulder.rotation.x =
        (leftArmSwing * armAmp * 1.02 +
          armForwardBias +
          (idleBreathChest * cfg.idleArmSway + idleMicro * 0.005) * idleWeight) ||
        0
      leftShoulder.rotation.y =
        ((-Math.max(0, leftArmSwing) * (0.045 + 0.065 * sprintRatio) +
          spineTwist * 0.18) *
          loco) ||
        0
      leftShoulder.rotation.z =
        (-(
          shoulderAbduct +
          idleBreathChest * 0.006 * idleWeight +
          doubleBounce * 0.008 * loco
        )) || 0
    }
    if (leftElbow) {
      const leftIdleElbow = cfg.idleElbowBend + 0.024 + idleBreathChest * 0.017
      const leftLocoElbow = clamp(
        locoElbowBase + locoElbowSwing * leftArmLag,
        0.12,
        1.75
      )
      leftElbow.rotation.x = lerp(leftIdleElbow, leftLocoElbow, loco) || 0
      leftElbow.rotation.y = -elbowInwardYaw || 0
    }
    if (leftWrist) {
      const leftIdleWrist = -0.044 + idleBreathChest * 0.015
      const leftLocoWrist = lerp(
        -0.038 - leftWristLag * 0.095,
        0.042 - leftWristLag * 0.06,
        sprintRatio
      )
      leftWrist.rotation.x = lerp(leftIdleWrist, leftLocoWrist, loco) || 0
      leftWrist.rotation.y = (-leftWristLag * 0.035 * loco) || 0
      leftWrist.rotation.z = (wristInwardRoll + idleMicro * 0.008 * idleWeight) || 0
    }

    if (rightShoulder) {
      rightShoulder.rotation.x =
        (rightArmSwing * armAmp * 0.97 +
          armForwardBias -
          (idleBreathChest * (cfg.idleArmSway * 0.9) - idleMicro * 0.004) *
            idleWeight) ||
        0
      rightShoulder.rotation.y =
        ((Math.max(0, rightArmSwing) * (0.045 + 0.065 * sprintRatio) +
          spineTwist * 0.18) *
          loco) ||
        0
      rightShoulder.rotation.z =
        (shoulderAbduct +
          idleBreathChest * 0.006 * idleWeight +
          doubleBounce * 0.008 * loco) ||
        0
    }
    if (rightElbow) {
      const rightIdleElbow = cfg.idleElbowBend - 0.016 - idleBreathChest * 0.013
      const rightLocoElbow = clamp(
        locoElbowBase + locoElbowSwing * rightArmLag,
        0.12,
        1.75
      )
      rightElbow.rotation.x = lerp(rightIdleElbow, rightLocoElbow, loco) || 0
      rightElbow.rotation.y = elbowInwardYaw || 0
    }
    if (rightWrist) {
      const rightIdleWrist = -0.036 - idleBreathChest * 0.013
      const rightLocoWrist = lerp(
        -0.038 - rightWristLag * 0.095,
        0.042 - rightWristLag * 0.06,
        sprintRatio
      )
      rightWrist.rotation.x = lerp(rightIdleWrist, rightLocoWrist, loco) || 0
      rightWrist.rotation.y = (rightWristLag * 0.035 * loco) || 0
      rightWrist.rotation.z = (-wristInwardRoll + idleMicro * 0.006 * idleWeight) || 0
    }

    // --- Spine / Upper Body & Head Stabilization ---
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
      spine.rotation.x = spineLean
      spine.rotation.y = spineTwist
      spine.rotation.z = spineRoll
    }

    const totalLean = pelvisX + spineLean
    const totalYaw = pelvisY + spineTwist
    const totalRoll = pelvisZ + spineRoll
    const stepNod = doubleBounce * lerp(0.008, 0.012, sprintRatio) * loco

    if (neck) {
      neck.rotation.x =
        (-totalLean * 0.42 - idleBreathChest * 0.008 * idleWeight + stepNod * 0.4) ||
        0
      neck.rotation.y = (-totalYaw * 0.46) || 0
      neck.rotation.z = (-totalRoll * 0.46) || 0

      if (head) {
        head.rotation.x =
          (-totalLean * (cfg.headCounterPitchFactor * 0.85) +
            idleBreathChest * 0.006 * idleWeight +
            stepNod * 0.6) ||
          0
        head.rotation.y = (-totalYaw * 0.46 + idleHeadScan) || 0
        head.rotation.z = (-totalRoll * 0.46 + idleHeadTilt) || 0
      }
    } else if (head) {
      head.rotation.x =
        (-totalLean * cfg.headCounterPitchFactor +
          idleBreathChest * 0.006 * idleWeight +
          stepNod) ||
        0
      head.rotation.y = (-totalYaw * 0.46 + idleHeadScan) || 0
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
