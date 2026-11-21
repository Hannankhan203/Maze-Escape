export const PLAYER_ANIM_STATES = {
  IDLE: 'idle',
  WALK: 'walk',
  SPRINT: 'sprint',
}

export const DEFAULT_PLAYER_ANIM_CONFIG = {
  idleFrequency: 2.1,
  idleBobAmplitude: 0.008,
  idleChestBreathLift: 0.003,
  idleArmSway: 0.016,
  idleTorsoPitch: 0.012,
  idleElbowBend: 0.18,
  idleKneeBend: 0.04,
  idlePelvisRoll: 0.014,
  idlePelvisTwist: 0.016,

  walkFrequency: 8.6,
  walkLegSwing: 0.48,
  walkArmSwing: 0.36,
  walkBobAmplitude: 0.03,
  walkTorsoLean: -0.045,
  walkTorsoTwist: 0.055,
  walkTorsoRoll: 0.016,
  walkPelvisTwist: 0.045,
  walkPelvisRoll: 0.026,
  walkKneeBaseBend: 0.05,
  walkKneeSwingBend: 0.82,
  walkKneeStanceBend: 0.12,
  walkHeelStrikePitch: 0.22,
  walkPushOffPitch: -0.34,
  walkElbowBaseBend: 0.32,
  walkElbowSwingBend: 0.22,

  sprintFrequency: 13.6,
  sprintLegSwing: 0.82,
  sprintArmSwing: 0.78,
  sprintArmBendPitch: 0.16,
  sprintBobAmplitude: 0.058,
  sprintTorsoLean: -0.14,
  sprintTorsoTwist: 0.105,
  sprintTorsoRoll: 0.028,
  sprintPelvisLean: -0.055,
  sprintPelvisTwist: 0.085,
  sprintPelvisRoll: 0.042,
  sprintHipDrive: 0.22,
  sprintKneeBaseBend: 0.10,
  sprintKneeSwingBend: 1.38,
  sprintKneeStanceBend: 0.24,
  sprintHeelStrikePitch: 0.15,
  sprintPushOffPitch: -0.52,
  sprintElbowBaseBend: 1.22,
  sprintElbowSwingBend: 0.34,
  sprintFlightLift: 0.038,

  headCounterPitchFactor: 0.55,
  stateBlendRate: 11.0,
  stopDampRate: 26.0,
}

const TWO_PI = Math.PI * 2
const THIGH_LENGTH = 0.42
const SHIN_LENGTH = 0.39
const BOOT_SOLE_HEIGHT = 0.10
const BOOT_TOE_EXTENT = 0.161
const BOOT_HEEL_EXTENT = 0.069
const HIP_OFFSET_X = 0.102
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
 * Drives idle breathing, walking, and sprinting gaits directly on the
 * `buildPlayer()` 16-pivot articulated rig (with legacy rig alias fallback),
 * synced to actual movement and collisions.
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
      if (pelvis.position) pelvis.position.y = restPelvisY
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
    this._applyNeutralPose()
  }

  /**
   * Advances procedural idle/walk/sprint blend weights and updates limb pivots.
   * Performs zero heap or Three.js object allocations per call.
   *
   * @param {number} delta - Elapsed frame delta time in seconds.
   * @param {{
   *   moved?: boolean,
   *   isSprinting?: boolean,
   *   actualSpeed?: number,
   *   walkSpeed?: number,
   *   sprintSpeed?: number,
   * }|null} [motion=null] - Actual post-collision movement sample for this frame.
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
        // Stop stride advancement immediately when movement stops, and damp
        // active limb swing swiftly back to grounded neutral/idle.
        const stopDecay = Math.exp(-cfg.stopDampRate * dt)
        this.walkWeight *= stopDecay
        this.sprintWeight *= stopDecay

        if (this.walkWeight + this.sprintWeight < 0.004) {
          this.walkWeight = 0
          this.sprintWeight = 0
          this.stridePhase = 0
        }

        this.idlePhase = (this.idlePhase + cfg.idleFrequency * dt) % TWO_PI
      } else {
        const blendAlpha = 1 - Math.exp(-cfg.stateBlendRate * dt)
        const targetWalk = nextState === PLAYER_ANIM_STATES.WALK ? 1 : 0
        const targetSprint = nextState === PLAYER_ANIM_STATES.SPRINT ? 1 : 0

        this.walkWeight += (targetWalk - this.walkWeight) * blendAlpha
        this.sprintWeight += (targetSprint - this.sprintWeight) * blendAlpha

        const locoSum = clamp(this.walkWeight + this.sprintWeight, 0, 1)
        const sprintRatio = locoSum > 1e-5 ? this.sprintWeight / locoSum : 0

        const strideLength = lerp(1.50, 2.20, sprintRatio)
        const distanceStep = actualSpeed * dt
        const strideRate = (distanceStep / strideLength) * TWO_PI
        this.stridePhase = (this.stridePhase + strideRate) % TWO_PI
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
    const hipSweepWave = 0.9 * (strideSin - 0.11 * Math.sin(3 * leftPhase))
    const doubleBounce = 0.5 * (1 - Math.cos(2 * leftPhase))

    const idleBreath = Math.sin(this.idlePhase)
    const idleShift = Math.sin(this.idlePhase * 0.5)
    const idleHeadScan = Math.sin(this.idlePhase * 0.35) * 0.032 * idleWeight
    const idleHeadTilt = idleShift * 0.01 * idleWeight

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

    // --- Pelvis & Torso Kinematics ---
    const pelvisX = (cfg.sprintPelvisLean * this.sprintWeight) || 0
    const pelvisYawAmp = lerp(cfg.walkPelvisTwist, cfg.sprintPelvisTwist, sprintRatio)
    const pelvisRollAmp = lerp(cfg.walkPelvisRoll, cfg.sprintPelvisRoll, sprintRatio)
    const pelvisY =
      (-strideSin * pelvisYawAmp * loco +
        idleShift * cfg.idlePelvisTwist * idleWeight) ||
      0
    const pelvisZ =
      (strideCos * pelvisRollAmp * loco +
        idleShift * cfg.idlePelvisRoll * idleWeight) ||
      0

    const spineLean =
      (lerp(cfg.walkTorsoLean, cfg.sprintTorsoLean, sprintRatio) * loco +
        (-0.01 + idleBreath * cfg.idleTorsoPitch) * idleWeight) ||
      0
    const spineTwist =
      (strideSin * lerp(cfg.walkTorsoTwist, cfg.sprintTorsoTwist, sprintRatio) * loco -
        idleShift * 0.008 * idleWeight) ||
      0
    const spineRoll =
      (-strideCos * lerp(cfg.walkTorsoRoll, cfg.sprintTorsoRoll, sprintRatio) * loco -
        idleShift * 0.012 * idleWeight) ||
      0

    // --- Leg Kinematics (Hip -> Knee -> Ankle) ---
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
    const swingAnkleDorsi = lerp(0.18, 0.24, sprintRatio)

    const idleHipX = 0.02
    const idleKneeX = -cfg.idleKneeBend
    const idleAnkleX = -(idleHipX + idleKneeX)

    // Left Leg
    const leftS = strideSin
    const leftC = strideCos
    const leftSwingBell = smoothUnitBell(Math.max(0, Math.cos(leftPhase - 0.2)))
    const leftStanceBell = smoothUnitBell(Math.max(0, -leftC))
    const leftContact = clamp(0.75 - 0.75 * leftC, 0, 1)

    const leftHipX =
      (hipSweepWave * legAmp +
        cfg.sprintHipDrive * sprintRatio * leftSwingBell * loco +
        idleHipX * idleWeight) ||
      0
    const leftLocoKneeX = -(
      baseKnee +
      swingKnee * leftSwingBell +
      stanceKnee * leftStanceBell
    )
    const leftKneeX =
      clamp(lerp(idleKneeX, leftLocoKneeX, loco), -1.75, 0) || 0

    const leftTargetWorldPitch =
      leftS >= 0 ? heelStrikePitch * leftS : pushOffPitch * -leftS
    const leftStanceAnkleX = leftTargetWorldPitch - (pelvisX + leftHipX + leftKneeX)
    const leftLocoAnkleX = clamp(
      lerp(swingAnkleDorsi, leftStanceAnkleX, leftContact),
      -0.62,
      0.52
    )
    const leftAnkleX = lerp(idleAnkleX, leftLocoAnkleX, loco) || 0

    // Right Leg
    const rightS = -strideSin
    const rightC = -strideCos
    const rightSwingBell = smoothUnitBell(Math.max(0, Math.cos(rightPhase - 0.2)))
    const rightStanceBell = smoothUnitBell(Math.max(0, -rightC))
    const rightContact = clamp(0.75 - 0.75 * rightC, 0, 1)

    const rightHipX =
      (-hipSweepWave * legAmp +
        cfg.sprintHipDrive * sprintRatio * rightSwingBell * loco +
        idleHipX * idleWeight) ||
      0
    const rightLocoKneeX = -(
      baseKnee +
      swingKnee * rightSwingBell +
      stanceKnee * rightStanceBell
    )
    const rightKneeX =
      clamp(lerp(idleKneeX, rightLocoKneeX, loco), -1.75, 0) || 0

    const rightTargetWorldPitch =
      rightS >= 0 ? heelStrikePitch * rightS : pushOffPitch * -rightS
    const rightStanceAnkleX =
      rightTargetWorldPitch - (pelvisX + rightHipX + rightKneeX)
    const rightLocoAnkleX = clamp(
      lerp(swingAnkleDorsi, rightStanceAnkleX, rightContact),
      -0.62,
      0.52
    )
    const rightAnkleX = lerp(idleAnkleX, rightLocoAnkleX, loco) || 0

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
        pelvis.position.y = groundedPelvisY + sprintFlightLift
      }
      pelvis.rotation.x = pelvisX
      pelvis.rotation.y = pelvisY
      pelvis.rotation.z = pelvisZ
    }

    if (leftHip) {
      leftHip.rotation.x = leftHipX
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
    }

    if (rightHip) {
      rightHip.rotation.x = rightHipX
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
    }

    // --- Arm Kinematics (Shoulder -> Elbow -> Wrist) ---
    const armAmp = lerp(cfg.walkArmSwing, cfg.sprintArmSwing, sprintRatio) * loco
    const armForwardBias = cfg.sprintArmBendPitch * this.sprintWeight
    const shoulderAbduct = 0.045 * (1 - this.sprintWeight) + 0.085 * this.sprintWeight

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
    const elbowInwardYaw = 0.04 * this.walkWeight + 0.14 * this.sprintWeight
    const wristInwardRoll = 0.045 + 0.015 * this.sprintWeight

    const leftArmSwing = -strideSin
    const rightArmSwing = strideSin

    if (leftShoulder) {
      leftShoulder.rotation.x =
        (leftArmSwing * armAmp +
          armForwardBias +
          idleBreath * cfg.idleArmSway * idleWeight) ||
        0
      leftShoulder.rotation.y =
        (-Math.max(0, leftArmSwing) * (0.04 + 0.06 * sprintRatio) * loco) || 0
      leftShoulder.rotation.z = -shoulderAbduct || 0
    }
    if (leftElbow) {
      const leftIdleElbow = cfg.idleElbowBend + idleBreath * 0.015
      const leftLocoElbow = clamp(
        locoElbowBase + locoElbowSwing * leftArmSwing,
        0.12,
        1.75
      )
      leftElbow.rotation.x = lerp(leftIdleElbow, leftLocoElbow, loco) || 0
      leftElbow.rotation.y = -elbowInwardYaw || 0
    }
    if (leftWrist) {
      const leftIdleWrist = -0.04 + idleBreath * 0.012
      const leftLocoWrist = lerp(
        -0.04 - leftArmSwing * 0.08,
        0.04 - leftArmSwing * 0.05,
        sprintRatio
      )
      leftWrist.rotation.x = lerp(leftIdleWrist, leftLocoWrist, loco) || 0
      leftWrist.rotation.z = wristInwardRoll || 0
    }

    if (rightShoulder) {
      rightShoulder.rotation.x =
        (rightArmSwing * armAmp +
          armForwardBias -
          idleBreath * cfg.idleArmSway * idleWeight) ||
        0
      rightShoulder.rotation.y =
        (Math.max(0, rightArmSwing) * (0.04 + 0.06 * sprintRatio) * loco) || 0
      rightShoulder.rotation.z = shoulderAbduct || 0
    }
    if (rightElbow) {
      const rightIdleElbow = cfg.idleElbowBend - idleBreath * 0.012
      const rightLocoElbow = clamp(
        locoElbowBase + locoElbowSwing * rightArmSwing,
        0.12,
        1.75
      )
      rightElbow.rotation.x = lerp(rightIdleElbow, rightLocoElbow, loco) || 0
      rightElbow.rotation.y = elbowInwardYaw || 0
    }
    if (rightWrist) {
      const rightIdleWrist = -0.04 - idleBreath * 0.012
      const rightLocoWrist = lerp(
        -0.04 - rightArmSwing * 0.08,
        0.04 - rightArmSwing * 0.05,
        sprintRatio
      )
      rightWrist.rotation.x = lerp(rightIdleWrist, rightLocoWrist, loco) || 0
      rightWrist.rotation.z = -wristInwardRoll || 0
    }

    // --- Spine / Upper Body & Head Stabilization ---
    if (spine) {
      if (spine.position) {
        if (pelvis) {
          spine.position.y =
            restSpineY + idleBreath * cfg.idleChestBreathLift * idleWeight
        } else {
          const bobAmp =
            lerp(cfg.walkBobAmplitude, cfg.sprintBobAmplitude, sprintRatio) * loco
          spine.position.y =
            restSpineY +
            doubleBounce * bobAmp +
            idleBreath * cfg.idleBobAmplitude * idleWeight
        }
      }
      spine.rotation.x = spineLean
      spine.rotation.y = spineTwist
      spine.rotation.z = spineRoll
    }

    const totalLean = pelvisX + spineLean
    const totalYaw = pelvisY + spineTwist
    const totalRoll = pelvisZ + spineRoll

    if (neck) {
      neck.rotation.x = (-totalLean * 0.4 - idleBreath * 0.008 * idleWeight) || 0
      neck.rotation.y = (-totalYaw * 0.45) || 0
      neck.rotation.z = (-totalRoll * 0.45) || 0

      if (head) {
        head.rotation.x =
          (-totalLean * (cfg.headCounterPitchFactor * 0.85) +
            idleBreath * 0.006 * idleWeight) ||
          0
        head.rotation.y = (-totalYaw * 0.45 + idleHeadScan) || 0
        head.rotation.z = (-totalRoll * 0.45 + idleHeadTilt) || 0
      }
    } else if (head) {
      head.rotation.x =
        (-totalLean * cfg.headCounterPitchFactor +
          idleBreath * 0.006 * idleWeight) ||
        0
      head.rotation.y = (-totalYaw * 0.45 + idleHeadScan) || 0
      head.rotation.z = (-totalRoll * 0.45) || 0
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
